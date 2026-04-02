import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { existsSync } from "node:fs";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { loadConfig } from "../../config.js";
import { DownloadService } from "../../services/download-service.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("webhook");

export const webhookRoutes = new Hono();

/**
 * POST /api/webhooks/slskd/download-complete
 *
 * Called by slskd's DownloadFileComplete script hook.
 * Body is $SLSKD_SCRIPT_DATA JSON:
 * {
 *   localFilename: string,
 *   remoteFilename: string,
 *   transfer: { username: string, filename: string, size: number, ... }
 * }
 */
webhookRoutes.post("/slskd/download-complete", async (c) => {
  const body = await c.req.json<{
    localFilename?: string;
    remoteFilename?: string;
    transfer?: {
      username?: string;
      filename?: string;
      size?: number;
    };
    // Also accept flat format for backward compat / manual testing
    username?: string;
    filename?: string;
    localPath?: string;
  }>().catch(() => ({}));

  // Extract fields from slskd's nested format or flat format
  const username = body.transfer?.username ?? body.username;
  const filename = body.transfer?.filename ?? body.remoteFilename ?? body.filename;
  const localPath = body.localFilename ?? body.localPath;

  if (!username || !filename) {
    return c.json({ ok: false, reason: "Missing required fields: transfer.username, transfer.filename (or remoteFilename)" }, 400);
  }

  // Map container path to host path (slskd reports /app/downloads/..., host has config.soulseek.downloadDir)
  const config = loadConfig();
  let hostPath = localPath;
  if (hostPath && hostPath.startsWith("/app/downloads/")) {
    hostPath = hostPath.replace("/app/downloads/", config.soulseek.downloadDir.replace(/\/$/, "") + "/");
  }

  log.info("Received slskd download-complete webhook", { username, filename, localPath: hostPath });

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
    log.warn("No matching download found for webhook", { username, filename });
    return c.json({ ok: false, reason: "No matching download in 'downloading' state" }, 404);
  }

  // Look up track info
  const track = db
    .select()
    .from(schema.tracks)
    .where(eq(schema.tracks.id, dl.trackId))
    .get();

  if (!track) {
    log.warn("Track not found for download", { downloadId: dl.id, trackId: dl.trackId });
    return c.json({ ok: false, reason: "Track not found" }, 404);
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

  // Find the file on disk — use localPath hint from webhook or fall back to search
  let filePath: string | null = null;
  if (hostPath && existsSync(hostPath)) {
    filePath = hostPath;
  } else {
    filePath = downloadService.findDownloadedFile(username, filename);
  }

  if (!filePath) {
    log.warn("Webhook fired but file not found on disk yet", { username, filename, hostPath });
    // Don't fail the download — the scanner will pick it up later
    return c.json({ ok: false, reason: "File not found on disk yet — scanner will retry" });
  }

  // Check file stability (not still being written)
  const stable = await downloadService.checkFileStable(filePath, 2000);
  if (!stable) {
    log.info("File found but still being written, deferring to scanner", { filePath });
    return c.json({ ok: false, reason: "File still being written — scanner will retry" });
  }

  const trackInfo = {
    title: track.title,
    artist: track.artist,
    album: track.album ?? undefined,
    durationMs: track.durationMs,
  };

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

  // Validate
  const valid = await downloadService.validateDownload(filePath, trackInfo, dl.trackId, slskdFile);
  if (!valid) {
    log.info("Webhook download failed validation", { filename, filePath });
    return c.json({ ok: false, reason: "File failed validation" });
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

  log.info("Download completed via webhook", {
    trackId: dl.trackId,
    filename,
    finalPath,
  });

  return c.json({ ok: true });
});
