import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getDb } from "../db/client.js";
import { loadConfig } from "../config.js";
import { ReviewService } from "../services/review-service.js";
import { LexiconService } from "../services/lexicon-service.js";
import type { LexiconTrack } from "../types/lexicon.js";

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "\u2014";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function registerReviewCommands(program: Command): void {
  const review = program
    .command("review")
    .description("Async review of pending matches");

  // ---------------------------------------------------------------------------
  // review list
  // ---------------------------------------------------------------------------

  review
    .command("list")
    .description("List pending review items")
    .option("--playlist <id>", "Filter to a specific playlist")
    .action(async (opts: { playlist?: string }) => {
      try {
        const config = loadConfig();
        const db = getDb();
        const reviewService = new ReviewService(config, { db });

        const pending = await reviewService.getPending(opts.playlist);

        if (pending.length === 0) {
          console.log(chalk.green("No pending matches to review."));
          return;
        }

        console.log(chalk.bold(`${pending.length} pending match(es) to review`));
        console.log();

        // Try to fetch Lexicon tracks for richer target info
        let lexiconById = new Map<string, LexiconTrack>();
        try {
          const lexicon = new LexiconService(config.lexicon);
          const allTracks = await lexicon.getTracks();
          for (const lt of allTracks) {
            lexiconById.set(lt.id, lt);
          }
        } catch {
          console.log(chalk.yellow("  Warning: Lexicon not available \u2014 target details will be limited"));
          console.log();
        }

        for (let i = 0; i < pending.length; i++) {
          const item = pending[i];
          const score = (item.score * 100).toFixed(0);

          console.log(
            chalk.bold(
              `  [${i + 1}] Match at ${chalk.yellow(`${score}%`)} (${item.method})`,
            ),
          );
          console.log();

          // Source info (Spotify)
          console.log(`    ${chalk.cyan("Spotify:")}  ${item.spotifyTrack.artist} \u2014 ${item.spotifyTrack.title}`);
          if (item.spotifyTrack.album) console.log(`               ${chalk.dim(`Album: ${item.spotifyTrack.album}`)}`);
          console.log(`               ${chalk.dim(`Duration: ${formatDuration(item.spotifyTrack.durationMs)}`)}`);

          console.log();

          // Target info (Lexicon)
          if (item.lexiconTrack.title) {
            console.log(`    ${chalk.magenta("Lexicon:")}  ${item.lexiconTrack.artist} \u2014 ${item.lexiconTrack.title}`);
            if (item.lexiconTrack.album) console.log(`               ${chalk.dim(`Album: ${item.lexiconTrack.album}`)}`);
            console.log(`               ${chalk.dim(`Duration: ${formatDuration(item.lexiconTrack.durationMs)}`)}`);
          } else {
            console.log(`    ${chalk.magenta("Lexicon:")}  ${chalk.dim(item.matchId)}`);
          }

          console.log();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  // ---------------------------------------------------------------------------
  // review confirm <id>
  // ---------------------------------------------------------------------------

  review
    .command("confirm <id>")
    .description("Confirm a pending review match")
    .action(async (id: string) => {
      try {
        const config = loadConfig();
        const db = getDb();
        const reviewService = new ReviewService(config, { db });

        // Prefix-match the ID
        const pending = await reviewService.getPending();
        const match = pending.find((p) => p.matchId.startsWith(id));

        if (!match) {
          console.log(chalk.red(`No pending match found with ID starting with "${id}".`));
          return;
        }

        await reviewService.confirm(match.matchId);
        console.log(chalk.green(`Match ${match.matchId.slice(0, 8)} confirmed.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  // ---------------------------------------------------------------------------
  // review reject <id>
  // ---------------------------------------------------------------------------

  review
    .command("reject <id>")
    .description("Reject a pending review match (queues download)")
    .action(async (id: string) => {
      try {
        const config = loadConfig();
        const db = getDb();
        const reviewService = new ReviewService(config, { db });

        // Prefix-match the ID
        const pending = await reviewService.getPending();
        const match = pending.find((p) => p.matchId.startsWith(id));

        if (!match) {
          console.log(chalk.red(`No pending match found with ID starting with "${id}".`));
          return;
        }

        await reviewService.reject(match.matchId);
        console.log(chalk.green(`Match ${match.matchId.slice(0, 8)} rejected.`));
        console.log(chalk.yellow("Download queued for this track."));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  // ---------------------------------------------------------------------------
  // review bulk-confirm
  // ---------------------------------------------------------------------------

  review
    .command("bulk-confirm")
    .description("Bulk confirm all pending matches")
    .option("--playlist <id>", "Scope to a specific playlist")
    .action(async (opts: { playlist?: string }) => {
      try {
        const config = loadConfig();
        const db = getDb();
        const reviewService = new ReviewService(config, { db });

        const pending = await reviewService.getPending(opts.playlist);

        if (pending.length === 0) {
          console.log(chalk.green("No pending matches to confirm."));
          return;
        }

        const rl = createInterface({ input: stdin, output: stdout });
        const answer = await rl.question(
          chalk.yellow(`Confirm ${pending.length} pending match(es)? [y/N] `),
        );
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(chalk.dim("Cancelled."));
          return;
        }

        const matchIds = pending.map((p) => p.matchId);
        const result = await reviewService.bulkConfirm(matchIds);
        console.log(chalk.green(`Confirmed ${result.confirmed} match(es).`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  // ---------------------------------------------------------------------------
  // review bulk-reject
  // ---------------------------------------------------------------------------

  review
    .command("bulk-reject")
    .description("Bulk reject all pending matches (queues downloads)")
    .option("--playlist <id>", "Scope to a specific playlist")
    .action(async (opts: { playlist?: string }) => {
      try {
        const config = loadConfig();
        const db = getDb();
        const reviewService = new ReviewService(config, { db });

        const pending = await reviewService.getPending(opts.playlist);

        if (pending.length === 0) {
          console.log(chalk.green("No pending matches to reject."));
          return;
        }

        const rl = createInterface({ input: stdin, output: stdout });
        const answer = await rl.question(
          chalk.yellow(`Reject ${pending.length} pending match(es)? This will queue downloads for all. [y/N] `),
        );
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(chalk.dim("Cancelled."));
          return;
        }

        const matchIds = pending.map((p) => p.matchId);
        const result = await reviewService.bulkReject(matchIds);
        console.log(chalk.green(`Rejected ${result.rejected} match(es).`));
        console.log(chalk.yellow(`${result.downloadsQueued} download(s) queued.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });

  // ---------------------------------------------------------------------------
  // review stats
  // ---------------------------------------------------------------------------

  review
    .command("stats")
    .description("Show review statistics")
    .action(async () => {
      try {
        const config = loadConfig();
        const db = getDb();
        const reviewService = new ReviewService(config, { db });

        const stats = await reviewService.getStats();

        console.log(chalk.bold("Review stats:"));
        console.log(`  Pending    ${chalk.yellow(String(stats.pending))}`);
        console.log(`  Confirmed  ${chalk.green(String(stats.confirmed))}`);
        console.log(`  Rejected   ${chalk.red(String(stats.rejected))}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Error: ${message}`));
      }
    });
}
