import { eq, and } from "drizzle-orm";
import type { Config } from "../../config.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import type { SlskdHubTransfer } from "../../services/slskd-hub.js";
import { createLogger } from "../../utils/logger.js";
import { createJob } from "../runner.js";

const log = createLogger("transfer-event");

/**
 * Handle a COMPLETED transfer event from the slskd SignalR hub.
 *
 * Mirrors the logic in webhooks.ts — finds the matching download row,
 * validates the file, and moves it to the playlist folder.
 */
export async function handleTransferCompleted(
  transfer: SlskdHubTransfer,
  config: Config,
): Promise<void> {
  const { username, filename } = transfer;

  // Only process downloads (direction 0), not uploads
  if (transfer.direction !== 0) return;

  log.info("SignalR: transfer completed", { username, filename });

  const db = getDb();

  // Find the matching download row: status='downloading' AND slskd_username/filename match
  const dl = db
    .select()
    .from(schema.downloads)
    .where(
      and(
        eq(schema.downloads.status, "downloading"),
        eq(schema.downloads.slskdUsername, username),
        eq(schema.downloads.slskdFilename, filename),
      ),
    )
    .get();

  if (!dl) {
    log.debug("No matching download for completed transfer", { username, filename });
    return;
  }

  // Look up track info
  const track = db
    .select()
    .from(schema.tracks)
    .where(eq(schema.tracks.id, dl.trackId))
    .get();

  if (!track) {
    log.warn("Track not found for download", { downloadId: dl.id, trackId: dl.trackId });
    return;
  }

  // Look up playlist name
  const playlist = dl.playlistId
    ? db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, dl.playlistId))
        .get()
    : undefined;
  const playlistName = playlist?.name ?? "Unknown";

  const downloadService = DownloadService.fromDb(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
    config.matching,
  );

  // Find the file on disk
  const filePath = downloadService.findDownloadedFile(username, filename);

  if (!filePath) {
    log.warn("SignalR COMPLETED but file not found on disk, deferring to scanner", {
      username,
      filename,
    });
    return;
  }

  // Check file stability (not still being written / moved)
  const stable = await downloadService.checkFileStable(filePath, 2000);
  if (!stable) {
    log.info("File found but still being written, deferring to scanner", { filename, filePath });
    return;
  }

  const trackInfo = {
    title: track.title,
    artist: track.artist,
    album: track.album ?? undefined,
    durationMs: track.durationMs,
  };

  const slskdFile = {
    filename,
    size: transfer.size,
    username,
    bitRate: undefined as number | undefined,
    sampleRate: undefined as number | undefined,
    bitDepth: undefined as number | undefined,
    length: undefined as number | undefined,
    code: "1",
  };

  // Validate
  const valid = await downloadService.validateDownload(filePath, trackInfo, dl.trackId, slskdFile);
  if (!valid) {
    log.info("SignalR completed download failed validation", { filename, filePath });
    // Leave as downloading — scanner may pick up a different file, or it will time out
    return;
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

  log.info("Download completed via SignalR", {
    trackId: dl.trackId,
    filename,
    finalPath,
  });
}

/**
 * Handle a FAILED transfer event from the slskd SignalR hub.
 *
 * Marks the download as failed and queues a retry search job.
 */
export async function handleTransferFailed(
  transfer: SlskdHubTransfer,
  config: Config,
): Promise<void> {
  const { username, filename } = transfer;

  // Only process downloads
  if (transfer.direction !== 0) return;

  log.info("SignalR: transfer failed", {
    username,
    filename,
    exception: transfer.exception,
    state: transfer.state,
  });

  const db = getDb();

  const dl = db
    .select()
    .from(schema.downloads)
    .where(
      and(
        eq(schema.downloads.status, "downloading"),
        eq(schema.downloads.slskdUsername, username),
        eq(schema.downloads.slskdFilename, filename),
      ),
    )
    .get();

  if (!dl) {
    log.debug("No matching download for failed transfer", { username, filename });
    return;
  }

  const errorMsg = transfer.exception
    ? `slskd transfer failed: ${transfer.exception}`
    : `slskd transfer failed (state: ${transfer.state})`;

  db.update(schema.downloads)
    .set({
      status: "failed",
      error: errorMsg,
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

    log.info("Auto-retry: created search job for SignalR-failed download", {
      trackId: dl.trackId,
      title: track.title,
      artist: track.artist,
    });
  }
}
