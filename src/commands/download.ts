import { Command } from "commander";
import chalk from "chalk";
import { eq, inArray } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { PlaylistService } from "../services/playlist-service.js";
import { SoulseekService } from "../services/soulseek-service.js";
import { DownloadService } from "../services/download-service.js";
import { SyncPipeline } from "../services/sync-pipeline.js";
import type { TrackInfo } from "../types/common.js";
import { Progress } from "../utils/progress.js";
import { checkHealth } from "../utils/health.js";

export function registerDownloadCommands(program: Command): void {
  const download = program
    .command("download")
    .description("Download tracks via Soulseek");

  download
    .command("search <query>")
    .description("Search Soulseek for a track")
    .action(async (query: string) => {
      try {
        const config = loadConfig();

        if (!config.soulseek.slskdApiKey) {
          console.log(chalk.red("Missing slskd API key."));
          console.log(chalk.dim("Set soulseek.slskdApiKey in your config."));
          return;
        }

        const soulseek = new SoulseekService(config.soulseek);

        console.log(chalk.dim(`Searching Soulseek for "${query}"...`));
        console.log();

        const files = await soulseek.search(query);

        if (files.length === 0) {
          console.log(chalk.yellow("No results found."));
          return;
        }

        const filenameW = 50;
        const userW = 16;
        const sizeW = 10;
        const brW = 6;

        console.log(
          chalk.bold(
            `${"Filename".padEnd(filenameW)}  ${"User".padEnd(userW)}  ${"Size".padEnd(sizeW)}  ${"BR".padEnd(brW)}`,
          ),
        );
        console.log(chalk.dim("─".repeat(filenameW + userW + sizeW + brW + 6)));

        // Show top 25 results
        const display = files.slice(0, 25);

        for (const file of display) {
          const parts = file.filename.split(/[/\\]/);
          const shortName = parts[parts.length - 1]?.slice(0, filenameW) ?? "";
          const user = (file.username ?? "").slice(0, userW);
          const sizeMb = file.size ? `${(file.size / (1024 * 1024)).toFixed(1)}MB` : "—";
          const br = file.bitRate ? `${file.bitRate}` : "—";

          console.log(
            `${shortName.padEnd(filenameW)}  ${chalk.dim(user.padEnd(userW))}  ${sizeMb.padStart(sizeW)}  ${chalk.cyan(br.padStart(brW))}`,
          );
        }

        console.log();
        console.log(chalk.dim(`${files.length} result(s) total, showing top ${display.length}.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Search failed: ${message}`));
      }
    });

  download
    .command("playlist <id>")
    .description("Download missing tracks for a playlist")
    .action(async (id: string) => {
      try {
        const config = loadConfig();
        const db = getDb();
        const playlistService = new PlaylistService(db);

        // 1. Resolve playlist by id, spotify_id, or name
        let playlist = playlistService.getPlaylist(id);
        if (!playlist) {
          const all = playlistService.getPlaylists();
          playlist = all.find(
            (p) => p.name.toLowerCase() === id.toLowerCase(),
          ) ?? null;
        }

        if (!playlist) {
          console.log(chalk.red(`Playlist not found: "${id}"`));
          console.log(chalk.dim("Use `crate-sync playlists list` to see available playlists."));
          return;
        }

        // 2. Get playlist tracks from DB
        const playlistTracks = playlistService.getPlaylistTracks(playlist.id);

        if (playlistTracks.length === 0) {
          console.log(chalk.yellow(`No tracks in playlist "${playlist.name}".`));
          console.log(chalk.dim("Run `crate-sync db sync` first to populate tracks."));
          return;
        }

        // 3. Match tracks against Lexicon to find which are missing
        console.log(chalk.dim(`Matching tracks in "${playlist.name}" against Lexicon...`));
        const pipeline = new SyncPipeline(config);
        const matchResult = await pipeline.matchPlaylist(playlist.id);

        const missingTracks = matchResult.notFound;
        const inLexicon = matchResult.confirmed.length + matchResult.pending.length;

        // 4. Print summary
        console.log();
        console.log(`  Total tracks       ${chalk.cyan(String(matchResult.total))}`);
        console.log(`  Already in Lexicon ${chalk.green(String(inLexicon))}`);
        console.log(`  To download        ${chalk.yellow(String(missingTracks.length))}`);
        console.log();

        if (missingTracks.length === 0) {
          console.log(chalk.green("All tracks are already in Lexicon. Nothing to download."));
          return;
        }

        // 5. Check slskd reachability via health check
        const health = await checkHealth(config);
        if (!health.soulseek.ok) {
          console.log(chalk.red(`Soulseek not available — ${health.soulseek.error}`));
          console.log(chalk.dim("Make sure slskd is running and the URL/API key are correct."));
          return;
        }

        // 6. Create DownloadService and download
        const downloadService = new DownloadService(
          db,
          config.soulseek,
          config.download,
          config.lexicon,
        );

        const batchItems = missingTracks.map((m) => ({
          track: m.track,
          dbTrackId: m.dbTrackId,
          playlistName: playlist.name,
        }));

        console.log(chalk.dim(`Downloading ${missingTracks.length} track(s)...`));
        console.log();

        let succeeded = 0;
        let failed = 0;
        const dlProgress = new Progress(missingTracks.length, "Downloading");

        // 7. Download with progress
        const results = await downloadService.downloadBatch(
          batchItems,
          (_done, _total, result) => {
            const item = batchItems.find((b) => b.dbTrackId === result.trackId);
            const title = item
              ? `${item.track.artist} - ${item.track.title}`
              : "Unknown";

            if (result.success) {
              succeeded++;
              dlProgress.tick(`${chalk.green("done")}  ${title}`);
            } else {
              failed++;
              dlProgress.tick(`${chalk.red("fail")}  ${title}`);
            }
          },
        );

        // 8. Persist download records
        for (const result of results) {
          db.insert(schema.downloads)
            .values({
              trackId: result.trackId,
              playlistId: playlist.id,
              status: result.success ? "done" : "failed",
              filePath: result.filePath ?? null,
              error: result.error ?? null,
              startedAt: Date.now(),
              completedAt: Date.now(),
            })
            .run();
        }

        // 9. Final summary
        console.log();
        console.log(chalk.bold("Download complete"));
        console.log(`  ${chalk.green(String(succeeded) + " downloaded")}  ${chalk.red(String(failed) + " failed")}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Download failed: ${message}`));
      }
    });

  download
    .command("resume")
    .description("Resume pending or failed downloads")
    .action(async () => {
      try {
        const config = loadConfig();
        const db = getDb();

        // 1. Query downloads with status pending or failed
        const pendingDownloads = db
          .select()
          .from(schema.downloads)
          .where(inArray(schema.downloads.status, ["pending", "failed"]))
          .all();

        if (pendingDownloads.length === 0) {
          console.log(chalk.green("No pending or failed downloads to resume."));
          return;
        }

        // 2. Get associated track info
        const trackIds = [...new Set(pendingDownloads.map((d) => d.trackId))];
        const trackRows = db
          .select()
          .from(schema.tracks)
          .where(inArray(schema.tracks.id, trackIds))
          .all();
        const trackMap = new Map(trackRows.map((t) => [t.id, t]));

        // Resolve playlist names for each download
        const playlistIds = [
          ...new Set(pendingDownloads.map((d) => d.playlistId).filter(Boolean)),
        ] as string[];
        const playlistRows = playlistIds.length > 0
          ? db
              .select()
              .from(schema.playlists)
              .where(inArray(schema.playlists.id, playlistIds))
              .all()
          : [];
        const playlistMap = new Map(playlistRows.map((p) => [p.id, p]));

        console.log(chalk.dim(`Resuming ${pendingDownloads.length} download(s)...`));
        console.log();

        // 3. Check slskd reachability
        if (!config.soulseek.slskdApiKey) {
          console.log(chalk.red("Missing slskd API key."));
          console.log(chalk.dim("Set soulseek.slskdApiKey in your config."));
          return;
        }

        const soulseek = new SoulseekService(config.soulseek);
        const reachable = await soulseek.ping();

        if (!reachable) {
          console.log(chalk.red("Cannot reach slskd."));
          console.log(chalk.dim(`Tried: ${config.soulseek.slskdUrl}`));
          console.log(chalk.dim("Make sure slskd is running and the URL/API key are correct."));
          return;
        }

        // 4. Build batch items
        const batchItems: Array<{
          track: TrackInfo;
          dbTrackId: string;
          playlistName: string;
          downloadId: string;
        }> = [];

        for (const dl of pendingDownloads) {
          const track = trackMap.get(dl.trackId);
          if (!track) continue;

          const playlist = dl.playlistId ? playlistMap.get(dl.playlistId) : null;
          const playlistName = playlist?.name ?? "Unknown";

          batchItems.push({
            track: {
              title: track.title,
              artist: track.artist,
              album: track.album ?? undefined,
              durationMs: track.durationMs,
              isrc: track.isrc ?? undefined,
              uri: track.spotifyUri ?? undefined,
            },
            dbTrackId: dl.trackId,
            playlistName,
            downloadId: dl.id,
          });
        }

        if (batchItems.length === 0) {
          console.log(chalk.yellow("No valid tracks found for pending downloads."));
          return;
        }

        // 5. Download with progress
        const downloadService = new DownloadService(
          db,
          config.soulseek,
          config.download,
          config.lexicon,
        );

        let succeeded = 0;
        let failed = 0;
        const resumeProgress = new Progress(batchItems.length, "Resuming");

        const results = await downloadService.downloadBatch(
          batchItems.map((b) => ({
            track: b.track,
            dbTrackId: b.dbTrackId,
            playlistName: b.playlistName,
          })),
          (_done, _total, result) => {
            const item = batchItems.find((b) => b.dbTrackId === result.trackId);
            const title = item
              ? `${item.track.artist} - ${item.track.title}`
              : "Unknown";

            if (result.success) {
              succeeded++;
              resumeProgress.tick(`${chalk.green("done")}  ${title}`);
            } else {
              failed++;
              resumeProgress.tick(`${chalk.red("fail")}  ${title}`);
            }
          },
        );

        // 6. Update download records
        for (const result of results) {
          const dlRecord = batchItems.find(
            (b) => b.dbTrackId === result.trackId,
          );
          if (!dlRecord) continue;

          db.update(schema.downloads)
            .set({
              status: result.success ? "done" : "failed",
              filePath: result.filePath ?? null,
              error: result.error ?? null,
              completedAt: Date.now(),
            })
            .where(eq(schema.downloads.id, dlRecord.downloadId))
            .run();
        }

        // 7. Final summary
        console.log();
        console.log(chalk.bold("Resume complete"));
        console.log(`  ${chalk.green(String(succeeded) + " downloaded")}  ${chalk.red(String(failed) + " failed")}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`Resume failed: ${message}`));
      }
    });
}
