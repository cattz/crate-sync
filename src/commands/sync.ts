import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { getDb } from "../db/client.js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SyncPipeline, type MatchPlaylistResult } from "../services/sync-pipeline.js";
import { checkHealth } from "../utils/health.js";
import { tryDetectServer, runThinClientSync } from "./sync-client.js";

export function registerSyncCommand(program: Command): void {
  const syncCmd = program
    .command("sync")
    .description("Run the non-blocking sync pipeline for a playlist or track");

  // Subcommand: sync track <id>
  syncCmd
    .command("track <trackId>")
    .description("Sync a single track with Lexicon")
    .action(async (trackId: string) => {
      try {
        const config = loadConfig();
        const db = getDb();

        // Resolve track by ID, spotifyId, or partial match
        let track = await db.query.tracks.findFirst({
          where: eq(schema.tracks.id, trackId),
        });
        if (!track) {
          track = await db.query.tracks.findFirst({
            where: eq(schema.tracks.spotifyId, trackId),
          });
        }

        if (!track) {
          console.log(chalk.red(`Track not found: "${trackId}"`));
          return;
        }

        console.log(chalk.bold(`Syncing "${track.title}" by ${track.artist}`));
        console.log();

        const pipeline = new SyncPipeline(config);
        const result = await pipeline.matchTrack(track.id);

        if (result.status === "confirmed") {
          console.log(chalk.green("  Status: Matched"));
        } else if (result.status === "pending") {
          console.log(chalk.yellow("  Status: Pending review"));
        } else {
          console.log(chalk.red("  Status: Not found"));
        }

        if (result.match) {
          console.log(`  Score:  ${chalk.cyan((result.match.score * 100).toFixed(0) + "%")}`);
          console.log(`  Method: ${result.match.method}`);
          console.log(`  Target: ${chalk.dim(result.match.lexiconTrackId)}`);
        }

        if (result.tagged) {
          console.log(chalk.green("  Tagged in Lexicon"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Sync failed: ${message}`));
      }
    });

  // Default action: sync playlist(s)
  syncCmd
    .command("playlist [playlist]", { isDefault: true })
    .description("Run the non-blocking sync pipeline for a playlist")
    .option("--all", "Sync all playlists")
    .option("--dry-run", "Show what would happen without making changes")
    .option("--tags", "Sync Spotify playlist name segments as Lexicon custom tags")
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
            console.log(chalk.dim(`Server detected at ${serverUrl} \u2014 using thin-client mode`));
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
          console.log(chalk.yellow(`Warning: Lexicon not available \u2014 ${health.lexicon.error}`));
        }
        if (!health.soulseek.ok) {
          console.log(chalk.yellow(`Warning: Soulseek not available \u2014 ${health.soulseek.error}`));
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
            console.log(chalk.dim("(dry run \u2014 no changes will be made)"));
            console.log();

            const result = await pipeline.dryRun(pl.id);
            printMatchSummary(result);
            console.log();
            continue;
          }

          // --- Phase 1: Match ---
          console.log(chalk.cyan("Phase 1 \u2014 Match"));
          const result = await pipeline.matchPlaylist(pl.id);
          printMatchSummary(result);
          console.log();

          // --- Tag sync ---
          if (opts.tags && result.confirmed.length > 0) {
            console.log(chalk.cyan("Syncing tags..."));
            const tagResult = await pipeline.syncTags(pl.name, result.confirmed);
            console.log(chalk.green(`  Tagged ${tagResult.tagged} track(s), skipped ${tagResult.skipped}`));
            console.log();
          }

          // --- Summary ---
          const confirmedAndTagged = result.confirmed.length;
          const pendingReview = result.pending.length;
          const notFoundCount = result.notFound.length;

          console.log(
            `  ${chalk.green(String(confirmedAndTagged))} confirmed and tagged, ` +
            `${chalk.yellow(String(pendingReview))} pending review, ` +
            `${chalk.red(String(notFoundCount))} queued for download`,
          );
          console.log();
        }

        console.log(chalk.green("Sync pipeline complete."));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Sync failed: ${message}`));
      }
    });
}

function printMatchSummary(result: MatchPlaylistResult): void {
  console.log(`  Total tracks    ${chalk.cyan(String(result.total))}`);
  console.log(`  Confirmed       ${chalk.green(String(result.confirmed.length))}`);
  console.log(`  Pending review  ${chalk.yellow(String(result.pending.length))}`);
  console.log(`  Not found       ${chalk.red(String(result.notFound.length))}`);
}
