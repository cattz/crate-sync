/**
 * Thin-client mode: delegates sync to a running crate-sync server via REST + SSE.
 */
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const DEFAULT_SERVER_URL = "http://localhost:3100";

/**
 * Try to detect a running crate-sync server.
 * Returns the base URL if reachable, null otherwise.
 */
export async function tryDetectServer(
  serverUrl = DEFAULT_SERVER_URL,
): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return serverUrl;
    return null;
  } catch {
    return null;
  }
}

interface SyncStartResponse {
  syncId: string;
  jobId: string;
}

interface ReviewItem {
  dbTrackId: string;
  title: string;
  artist: string;
  score: number;
  confidence: string;
  method: string;
}

/**
 * Run sync via thin-client mode: POST to start, stream SSE events,
 * prompt for review when needed, display progress.
 */
export async function runThinClientSync(
  serverUrl: string,
  playlistId: string,
  playlistName: string,
  opts: { dryRun?: boolean; verbose?: boolean },
): Promise<void> {
  console.log(
    chalk.dim(`  Delegating to server at ${serverUrl}`),
  );
  console.log();

  // --- Dry run ---
  if (opts.dryRun) {
    console.log(chalk.dim("(dry run — no changes will be made)"));
    console.log();

    const res = await fetch(
      `${serverUrl}/api/sync/${playlistId}/dry-run`,
      { method: "POST" },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ?? `Server returned ${res.status}`,
      );
    }

    const result = (await res.json()) as {
      total: number;
      found: unknown[];
      needsReview: unknown[];
      notFound: unknown[];
    };

    console.log(`  Total tracks    ${chalk.cyan(String(result.total))}`);
    console.log(`  Found           ${chalk.green(String(result.found.length))}`);
    console.log(`  Needs review    ${chalk.yellow(String(result.needsReview.length))}`);
    console.log(`  Not found       ${chalk.red(String(result.notFound.length))}`);
    return;
  }

  // --- Start sync ---
  const startRes = await fetch(`${serverUrl}/api/sync/${playlistId}`, {
    method: "POST",
  });

  if (!startRes.ok) {
    const body = await startRes.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Server returned ${startRes.status}`,
    );
  }

  const { syncId } = (await startRes.json()) as SyncStartResponse;

  // --- Connect to SSE stream ---
  const eventRes = await fetch(`${serverUrl}/api/sync/${syncId}/events`);
  if (!eventRes.ok || !eventRes.body) {
    throw new Error("Failed to connect to sync event stream");
  }

  const reader = eventRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let matchResult: { found: number; review: number; notFound: number } | null =
    null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE frames from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    let currentData = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        currentData = line.slice(6);
      } else if (line === "" && currentEvent && currentData) {
        // Complete SSE frame
        const data = JSON.parse(currentData);
        const shouldStop = await handleSSEEvent(
          currentEvent,
          data,
          serverUrl,
          syncId,
          opts,
        );

        if (currentEvent === "match-complete") {
          matchResult = data;
        }

        currentEvent = "";
        currentData = "";

        if (shouldStop) {
          reader.cancel();
          return;
        }
      }
    }
  }
}

/**
 * Handle a single SSE event. Returns true if we should stop reading.
 */
async function handleSSEEvent(
  event: string,
  data: unknown,
  serverUrl: string,
  syncId: string,
  opts: { verbose?: boolean },
): Promise<boolean> {
  const d = data as Record<string, unknown>;

  switch (event) {
    case "phase": {
      const phase = d.phase as string;
      const labels: Record<string, string> = {
        match: "Phase 1 — Match",
        review: "Phase 2 — Review",
        download: "Phase 3 — Download",
        done: "Done",
      };
      if (phase === "done") {
        // handled by sync-complete
      } else {
        console.log(chalk.cyan(labels[phase] ?? phase));
      }
      break;
    }

    case "match-complete": {
      const found = d.found as number;
      const review = d.review as number;
      const notFound = d.notFound as number;
      const total = found + review + notFound;
      console.log(`  Total tracks    ${chalk.cyan(String(total))}`);
      console.log(`  Found           ${chalk.green(String(found))}`);
      console.log(`  Needs review    ${chalk.yellow(String(review))}`);
      console.log(`  Not found       ${chalk.red(String(notFound))}`);
      console.log();
      break;
    }

    case "review-needed": {
      const items = d.items as ReviewItem[];
      console.log(chalk.cyan("Phase 2 — Review"));
      console.log(chalk.dim(`  ${items.length} track(s) need manual review`));
      console.log();

      const decisions = await promptReviewDecisions(items);

      // Post decisions back to server
      await fetch(`${serverUrl}/api/sync/${syncId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions }),
      });

      const accepted = decisions.filter((d) => d.accepted).length;
      const rejected = decisions.filter((d) => !d.accepted).length;
      console.log(
        `  Accepted ${chalk.green(String(accepted))}, rejected ${chalk.red(String(rejected))}`,
      );
      console.log();
      break;
    }

    case "download-progress": {
      const completed = d.completed as number;
      const total = d.total as number;
      const trackTitle = d.trackTitle as string;
      const success = d.success as boolean;
      const error = d.error as string | undefined;

      const status = success ? chalk.green("✓") : chalk.red("✗");
      console.log(`  ${status} [${completed}/${total}] ${trackTitle}`);
      if (!success && error) {
        console.log(`    ${chalk.dim(error)}`);
      }
      break;
    }

    case "sync-complete": {
      const found = d.found as number;
      const downloaded = d.downloaded as number;
      const failed = d.failed as number;

      console.log();
      console.log(
        `  Downloads: ${chalk.green(String(downloaded) + " succeeded")}, ${chalk.red(String(failed) + " failed")}`,
      );
      console.log();
      console.log(chalk.green("Sync pipeline complete."));
      return true;
    }

    case "error": {
      const message = d.message as string;
      console.log(chalk.red(`Sync error: ${message}`));
      return true;
    }
  }

  return false;
}

/**
 * Prompt the user for review decisions on the terminal.
 */
async function promptReviewDecisions(
  items: ReviewItem[],
): Promise<Array<{ dbTrackId: string; accepted: boolean }>> {
  const decisions: Array<{ dbTrackId: string; accepted: boolean }> = [];
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const score = (item.score * 100).toFixed(0);

      console.log(
        chalk.bold(
          `  [${i + 1}/${items.length}] Match at ${chalk.yellow(`${score}%`)}`,
        ),
      );
      console.log();
      console.log(
        `    ${chalk.cyan("Spotify:")}  ${item.artist} — ${item.title}`,
      );
      console.log(
        `    ${chalk.dim(`Confidence: ${item.confidence}, Method: ${item.method}`)}`,
      );
      console.log();

      const answer = await rl.question(
        chalk.bold("  Accept? (y/n/a=all/q=quit): "),
      );
      const choice = answer.trim().toLowerCase();

      if (choice === "a") {
        for (let j = i; j < items.length; j++) {
          decisions.push({ dbTrackId: items[j].dbTrackId, accepted: true });
        }
        break;
      } else if (choice === "q") {
        for (let j = i; j < items.length; j++) {
          decisions.push({ dbTrackId: items[j].dbTrackId, accepted: false });
        }
        break;
      } else {
        decisions.push({
          dbTrackId: item.dbTrackId,
          accepted: choice === "y" || choice === "yes",
        });
      }

      console.log();
    }
  } finally {
    rl.close();
  }

  return decisions;
}
