import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SyncPipeline, type PhaseOneResult, type ReviewDecision } from "../services/sync-pipeline.js";
import type { DownloadResult } from "../services/download-service.js";
import { Progress } from "../utils/progress.js";
import { checkHealth } from "../utils/health.js";
import { tryDetectServer, runThinClientSync } from "./sync-client.js";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync [playlist]")
    .description("Run the full sync pipeline for a playlist")
    .option("--all", "Sync all playlists")
    .option("--dry-run", "Show what would happen without making changes")
    .option("--tags", "Sync Spotify playlist name segments as Lexicon custom tags (default: off)")
    .option("--verbose", "Show per-track search diagnostics (query strategies, candidate counts)")
    .option("--standalone", "Force standalone mode (skip server detection)")
    .option("--server <url>", "Server URL to connect to (default: http://localhost:3100)")
    .action(async (playlist: string | undefined, opts: { all?: boolean; dryRun?: boolean; tags?: boolean; verbose?: boolean; standalone?: boolean; server?: string }) => {
      if (!playlist && !opts.all) {
        console.log(chalk.red("Provide a playlist name/ID or use --all."));
        return;
      }

      try {
        // --- Thin-client mode: delegate to running server ---
        if (!opts.standalone) {
          const serverUrl = await tryDetectServer(opts.server);
          if (serverUrl) {
            console.log(chalk.dim(`Server detected at ${serverUrl} — using thin-client mode`));
            console.log(chalk.dim(`(use --standalone to run the pipeline directly)`));
            console.log();

            // Resolve playlists locally so we can pass IDs to the server
            const db = getDb();
            const playlistService = new PlaylistService(db);

            let playlistsToSync: schema.Playlist[] = [];
            if (opts.all) {
              playlistsToSync = playlistService.getPlaylists();
              if (playlistsToSync.length === 0) {
                console.log(chalk.red("No playlists in database. Run `crate-sync db sync` first."));
                return;
              }
            } else {
              let resolved = playlistService.getPlaylist(playlist!);
              if (!resolved) {
                const all = playlistService.getPlaylists();
                resolved = all.find(
                  (p) => p.name.toLowerCase() === playlist!.toLowerCase(),
                ) ?? null;
              }
              if (!resolved) {
                console.log(chalk.red(`Playlist not found: "${playlist}"`));
                console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
                return;
              }
              playlistsToSync = [resolved];
            }

            for (const pl of playlistsToSync) {
              console.log(chalk.bold(`Syncing "${pl.name}"`));
              console.log();
              await runThinClientSync(serverUrl, pl.id, pl.name, {
                dryRun: opts.dryRun,
                verbose: opts.verbose,
              });
              console.log();
            }

            return;
          }
        }

        // --- Standalone mode: run pipeline directly ---
        const config = loadConfig();
        const db = getDb();
        const playlistService = new PlaylistService(db);
        const pipeline = new SyncPipeline(config);

        // Pre-flight health checks
        const health = await checkHealth(config);
        if (!health.lexicon.ok) {
          console.log(chalk.yellow(`Warning: Lexicon not available — ${health.lexicon.error}`));
        }
        if (!health.soulseek.ok) {
          console.log(chalk.yellow(`Warning: Soulseek not available — ${health.soulseek.error}`));
        }

        // Resolve which playlists to sync
        let playlistsToSync: schema.Playlist[] = [];

        if (opts.all) {
          playlistsToSync = playlistService.getPlaylists();
          if (playlistsToSync.length === 0) {
            console.log(chalk.red("No playlists in database. Run `crate-sync db sync` first."));
            return;
          }
        } else {
          // Resolve by ID, spotify ID, or name
          let resolved = playlistService.getPlaylist(playlist!);
          if (!resolved) {
            const all = playlistService.getPlaylists();
            resolved = all.find(
              (p) => p.name.toLowerCase() === playlist!.toLowerCase(),
            ) ?? null;
          }

          if (!resolved) {
            console.log(chalk.red(`Playlist not found: "${playlist}"`));
            console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
            return;
          }

          playlistsToSync = [resolved];
        }

        for (const pl of playlistsToSync) {
          console.log(chalk.bold(`Syncing "${pl.name}"`));
          console.log();

          // --- Dry run ---
          if (opts.dryRun) {
            console.log(chalk.dim("(dry run — no changes will be made)"));
            console.log();

            const result = await pipeline.dryRun(pl.id);
            printPhaseOneSummary(result);
            console.log();
            continue;
          }

          // --- Phase 1: Match ---
          console.log(chalk.cyan("Phase 1 — Match"));
          const phaseOne = await pipeline.matchPlaylist(pl.id);
          printPhaseOneSummary(phaseOne);
          console.log();

          // --- Phase 2: Review ---
          let decisions: ReviewDecision[] = [];

          if (phaseOne.needsReview.length > 0) {
            console.log(chalk.cyan("Phase 2 — Review"));
            console.log(chalk.dim(`  ${phaseOne.needsReview.length} track(s) need manual review`));
            console.log();

            const rl = createInterface({ input: stdin, output: stdout });

            try {
              for (let i = 0; i < phaseOne.needsReview.length; i++) {
                const item = phaseOne.needsReview[i];
                const score = (item.score * 100).toFixed(0);
                const src = item.track;
                const lex = item.lexiconTrack;

                console.log(chalk.bold(`  [${i + 1}/${phaseOne.needsReview.length}] Match at ${chalk.yellow(`${score}%`)}`));
                console.log();
                console.log(`    ${chalk.cyan("Spotify:")}  ${src.artist} — ${src.title}`);
                if (src.album) console.log(`               ${chalk.dim(`Album: ${src.album}`)}`);
                if (src.durationMs) console.log(`               ${chalk.dim(`Duration: ${formatDuration(src.durationMs)}`)}`);
                console.log();
                if (lex) {
                  console.log(`    ${chalk.magenta("Lexicon:")}  ${lex.artist} — ${lex.title}`);
                  if (lex.album) console.log(`               ${chalk.dim(`Album: ${lex.album}`)}`);
                  if (lex.durationMs) console.log(`               ${chalk.dim(`Duration: ${formatDuration(lex.durationMs)}`)}`);
                } else {
                  console.log(`    ${chalk.magenta("Lexicon:")}  ${chalk.dim("(details unavailable)")}`);
                }
                console.log();

                const answer = await rl.question(
                  chalk.bold("  Accept? (y/n/a=all/q=quit): "),
                );
                const choice = answer.trim().toLowerCase();

                if (choice === "a") {
                  // Accept this and all remaining
                  for (let j = i; j < phaseOne.needsReview.length; j++) {
                    decisions.push({ dbTrackId: phaseOne.needsReview[j].dbTrackId, accepted: true });
                  }
                  break;
                } else if (choice === "q") {
                  // Reject this and all remaining
                  for (let j = i; j < phaseOne.needsReview.length; j++) {
                    decisions.push({ dbTrackId: phaseOne.needsReview[j].dbTrackId, accepted: false });
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

            const acceptedCount = decisions.filter((d) => d.accepted).length;
            const rejectedCount = decisions.filter((d) => !d.accepted).length;
            console.log();
            console.log(
              `  Accepted ${chalk.green(String(acceptedCount))}, rejected ${chalk.red(String(rejectedCount))}`,
            );
          } else {
            console.log(chalk.cyan("Phase 2 — Review"));
            console.log(chalk.dim("  No tracks need review."));
          }

          const phaseTwo = pipeline.applyReviewDecisions(phaseOne, decisions);
          console.log();

          // --- Phase 3: Download ---
          if (phaseTwo.missing.length > 0) {
            console.log(chalk.cyan("Phase 3 — Download"));
            console.log(chalk.dim(`  ${phaseTwo.missing.length} track(s) to download`));
            console.log();

            // Interactive download review
            const dlReviewRl = createInterface({ input: stdin, output: stdout });
            const downloadReview: DownloadReviewFn = async (candidate, index, reviewTotal) => {
              const score = (candidate.score * 100).toFixed(0);
              const src = candidate.track;
              const cand = candidate.parsedTrack;
              const file = candidate.file;

              console.log(chalk.bold(`  [${index + 1}/${reviewTotal}] Download match at ${chalk.yellow(`${score}%`)}`));
              console.log();
              console.log(`    ${chalk.cyan("Looking for:")}  ${src.artist} — ${src.title}`);
              if (src.durationMs) console.log(`                   ${chalk.dim(`Duration: ${formatDuration(src.durationMs)}`)}`);
              console.log();
              console.log(`    ${chalk.magenta("Found:")}        ${cand.artist || chalk.dim("(unknown)")} — ${cand.title || chalk.dim("(unknown)")}`);
              console.log(`                   ${chalk.dim(`File: ${file.filename}`)}`);
              if (file.bitRate) console.log(`                   ${chalk.dim(`Bitrate: ${file.bitRate} kbps`)}`);
              if (file.length) console.log(`                   ${chalk.dim(`Duration: ${formatDuration(file.length * 1000)}`)}`);
              console.log();

              const answer = await dlReviewRl.question(
                chalk.bold("  Download? (y/n/a=all/q=quit): "),
              );
              const choice = answer.trim().toLowerCase();
              console.log();

              if (choice === "a") return "all";
              if (choice === "q") return false;
              return choice === "y" || choice === "yes";
            };

            const downloadResult = await pipeline.downloadMissing(
              phaseTwo,
              pl.name,
              (done, total, title, success, error, meta) => {
                const status = success ? chalk.green("✓") : chalk.red("✗");
                console.log(`  ${status} [${done}/${total}] ${title}`);
                if (!success && error) {
                  console.log(`    ${chalk.dim(error)}`);
                }
                if (opts.verbose && meta) {
                  if (meta.strategy) {
                    console.log(`    ${chalk.dim(`Strategy: ${meta.strategy}`)}`);
                  }
                  if (meta.strategyLog) {
                    for (const s of meta.strategyLog) {
                      const icon = s.resultCount > 0 ? chalk.green("✓") : chalk.dim("·");
                      console.log(`    ${icon} ${chalk.dim(`[${s.label}] "${s.query}" → ${s.resultCount} candidates`)}`);
                    }
                  }
                  if (meta.topCandidates && meta.topCandidates.length > 0) {
                    console.log(`    ${chalk.dim("Top candidates:")}`);
                    for (const c of meta.topCandidates.slice(0, 3)) {
                      console.log(`      ${chalk.dim(`${(c.score * 100).toFixed(0)}% — ${c.filename}`)}`);
                    }
                  }
                }
              },
              downloadReview,
            );

            dlReviewRl.close();

            console.log();
            console.log(
              `  Downloads: ${chalk.green(String(downloadResult.succeeded) + " succeeded")}, ${chalk.red(String(downloadResult.failed) + " failed")}`,
            );
          } else {
            console.log(chalk.cyan("Phase 3 — Download"));
            console.log(chalk.dim("  No tracks to download."));
          }

          console.log();

          // --- Sync to Lexicon ---
          const allMatchedIds = phaseTwo.confirmed
            .filter((m) => m.lexiconTrackId)
            .map((m) => m.lexiconTrackId!);

          if (allMatchedIds.length > 0) {
            console.log(chalk.cyan("Syncing to Lexicon..."));
            await pipeline.syncToLexicon(pl.id, pl.name, allMatchedIds);
            console.log(chalk.green(`  Synced ${allMatchedIds.length} track(s) to Lexicon playlist "${pl.name}"`));

            // --- Tag sync ---
            if (opts.tags) {
              console.log(chalk.cyan("Syncing tags..."));
              const tagResult = await pipeline.syncTags(pl.name, phaseTwo.confirmed);
              console.log(chalk.green(`  Tagged ${tagResult.tagged} track(s), skipped ${tagResult.skipped}`));
            }
          } else {
            console.log(chalk.dim("No matched tracks to sync to Lexicon."));
          }

          console.log();
        }

        console.log(chalk.green("Sync pipeline complete."));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Sync failed: ${message}`));
      }
    });
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function printPhaseOneSummary(result: PhaseOneResult): void {
  console.log(`  Total tracks    ${chalk.cyan(String(result.total))}`);
  console.log(`  Found           ${chalk.green(String(result.found.length))}`);
  console.log(`  Needs review    ${chalk.yellow(String(result.needsReview.length))}`);
  console.log(`  Not found       ${chalk.red(String(result.notFound.length))}`);
}
