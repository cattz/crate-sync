import { eq, and, isNotNull } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import { completeJob, createJob } from "../runner.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("download-scan");

/**
 * Periodic filesystem scanner for pending downloads.
 *
 * Queries downloads with status="downloading" and slskdUsername/slskdFilename set,
 * then checks the filesystem for each. If the file is found and stable, validates
 * and moves it. If the download has timed out, marks it failed and creates a new
 * search job for auto-retry.
 */
export async function handleDownloadScan(job: Job, config: Config): Promise<void> {
  const db = getDb();

  // Find all downloads that are in "downloading" state with slskd file info
  const pending = db
    .select()
    .from(schema.downloads)
    .where(
      and(
        eq(schema.downloads.status, "downloading"),
        isNotNull(schema.downloads.slskdUsername),
        isNotNull(schema.downloads.slskdFilename),
      ),
    )
    .all();

  if (pending.length === 0) {
    completeJob(job.id, { scanned: 0, completed: 0, timedOut: 0 });
    return;
  }

  log.info(`Scanning ${pending.length} pending downloads`);

  const downloadService = DownloadService.fromDb(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
  );

  const timeoutMs = config.soulseek.downloadTimeoutMs;
  const now = Date.now();
  let completed = 0;
  let timedOut = 0;

  for (const dl of pending) {
    const username = dl.slskdUsername!;
    const filename = dl.slskdFilename!;

    // Check if file exists on disk
    const filePath = downloadService.findDownloadedFile(username, filename);

    if (filePath) {
      // File found — check if it's stable (not still being written)
      const stable = await downloadService.checkFileStable(filePath);
      if (!stable) {
        log.info(`File found but still being written`, { filename, filePath });
        continue;
      }

      // Look up the track for validation
      const track = db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.id, dl.trackId))
        .get();

      if (!track) {
        log.warn(`Track not found for download`, { downloadId: dl.id, trackId: dl.trackId });
        continue;
      }

      // Look up playlist name for move
      const playlist = dl.playlistId
        ? db.query.playlists.findFirst({
            where: eq(schema.playlists.id, dl.playlistId),
          })
        : undefined;
      const playlistName = (await playlist)?.name ?? "Unknown";

      const slskdFile = {
        filename,
        size: 0,
        username,
        bitRate: undefined as number | undefined,
        sampleRate: undefined as number | undefined,
        bitDepth: undefined as number | undefined,
        length: undefined as number | undefined,
        code: "1",
      };

      const trackInfo = {
        title: track.title,
        artist: track.artist,
        album: track.album ?? undefined,
        durationMs: track.durationMs,
      };

      // Validate
      const valid = await downloadService.validateDownload(filePath, trackInfo, dl.trackId, slskdFile);
      if (!valid) {
        log.info(`Downloaded file failed validation`, { filename, filePath });
        // Leave as downloading — might get a different file, or will time out
        continue;
      }

      // Move to playlist folder
      const finalPath = downloadService.moveToPlaylistFolder(filePath, playlistName, trackInfo);

      db.update(schema.downloads)
        .set({
          status: "done",
          filePath: finalPath,
          completedAt: Date.now(),
        })
        .where(eq(schema.downloads.id, dl.id))
        .run();

      log.info(`Download completed via scanner`, {
        trackId: dl.trackId,
        filename,
        finalPath,
      });

      completed++;
      continue;
    }

    // File not found — check for timeout
    const startedAt = dl.startedAt ?? dl.createdAt;
    const elapsed = now - startedAt;

    if (elapsed > timeoutMs) {
      log.info(`Download timed out`, {
        downloadId: dl.id,
        trackId: dl.trackId,
        filename,
        elapsedMs: elapsed,
        timeoutMs,
      });

      db.update(schema.downloads)
        .set({
          status: "failed",
          error: `Download timed out after ${Math.round(elapsed / 60_000)}min`,
          completedAt: Date.now(),
        })
        .where(eq(schema.downloads.id, dl.id))
        .run();

      // Auto-retry: create a new search job for this track
      const track = db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.id, dl.trackId))
        .get();

      if (track && dl.playlistId) {
        createJob({
          type: "search",
          status: "queued",
          priority: 3,
          payload: JSON.stringify({
            trackId: dl.trackId,
            playlistId: dl.playlistId,
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationMs: track.durationMs,
            queryIndex: 0,
          }),
        });

        log.info(`Auto-retry: created search job for timed-out download`, {
          trackId: dl.trackId,
          title: track.title,
          artist: track.artist,
        });
      }

      timedOut++;
    }
  }

  completeJob(job.id, { scanned: pending.length, completed, timedOut });
}
