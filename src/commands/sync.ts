import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SyncPipeline, type PhaseOneResult, type ReviewDecision } from "../services/sync-pipeline.js";
import { checkHealth } from "../utils/health.js";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync [playlist]")
    .description("Run the full sync pipeline for a playlist")
    .option("--all", "Sync all playlists")
    .option("--dry-run", "Show what would happen without making changes")
    .action(async (playlist: string | undefined, opts: { all?: boolean; dryRun?: boolean }) => {
      if (!playlist && !opts.all) {
        console.log(chalk.red("Provide a playlist name/ID or use --all."));
        return;
      }

      try {
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
            console.log();
            console.log("The following tracks need manual review:");
            console.log();

            for (let i = 0; i < phaseOne.needsReview.length; i++) {
              const item = phaseOne.needsReview[i];
              const score = (item.score * 100).toFixed(0);
              console.log(
                `  ${chalk.cyan(String(i + 1).padStart(3))}. ${item.track.title} — ${chalk.dim(item.track.artist)}  ${chalk.yellow(`${score}%`)}`,
              );
            }

            console.log();

            const rl = createInterface({ input: stdin, output: stdout });

            try {
              const answer = await rl.question(
                chalk.bold('Accept which? (e.g. "1,3,5", "all", "none"): '),
              );

              const trimmed = answer.trim().toLowerCase();

              if (trimmed === "all") {
                decisions = phaseOne.needsReview.map((item) => ({
                  dbTrackId: item.dbTrackId,
                  accepted: true,
                }));
              } else if (trimmed === "none" || trimmed === "") {
                decisions = phaseOne.needsReview.map((item) => ({
                  dbTrackId: item.dbTrackId,
                  accepted: false,
                }));
              } else {
                const accepted = new Set(
                  trimmed
                    .split(",")
                    .map((s) => parseInt(s.trim(), 10))
                    .filter((n) => !isNaN(n)),
                );

                decisions = phaseOne.needsReview.map((item, i) => ({
                  dbTrackId: item.dbTrackId,
                  accepted: accepted.has(i + 1),
                }));
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

            const downloadResult = await pipeline.downloadMissing(
              phaseTwo,
              pl.name,
              (done, total, title, success) => {
                const status = success ? chalk.green("done") : chalk.red("fail");
                console.log(`  [${done}/${total}] ${status}  ${title}`);
              },
            );

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

function printPhaseOneSummary(result: PhaseOneResult): void {
  console.log(`  Total tracks    ${chalk.cyan(String(result.total))}`);
  console.log(`  Found           ${chalk.green(String(result.found.length))}`);
  console.log(`  Needs review    ${chalk.yellow(String(result.needsReview.length))}`);
  console.log(`  Not found       ${chalk.red(String(result.notFound.length))}`);
}
