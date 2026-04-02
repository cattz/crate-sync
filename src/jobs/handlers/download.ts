import { eq, and, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import { SoulseekService } from "../../services/soulseek-service.js";
import { completeJob } from "../runner.js";
import { createLogger } from "../../utils/logger.js";

const MAX_PER_USER = 2;

const log = createLogger("download-handler");

interface DownloadPayload {
  trackId: string;
  playlistId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  file: {
    filename: string;
    size: number;
    username: string;
    bitRate?: number;
  };
  score: number;
  strategy?: string;
}

/**
 * Fire-and-forget download handler.
 *
 * Initiates the slskd transfer, checks if the file already exists on disk,
 * and either completes immediately (file found + valid) or records the
 * download as "downloading" for the background scanner to pick up.
 */
export async function handleDownload(job: Job, config: Config): Promise<void> {
  const payload: DownloadPayload = JSON.parse(job.payload ?? "{}");
  const db = getDb();

  const { username, filename, size } = payload.file;

  // Per-user concurrency limit — avoid "Too many files" rejection from remote peers
  const activeFromUser = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.downloads)
    .where(
      and(
        eq(schema.downloads.slskdUsername, username),
        eq(schema.downloads.status, "downloading"),
      ),
    )
    .get();

  if ((activeFromUser?.count ?? 0) >= MAX_PER_USER) {
    log.info(`Per-user limit reached (${MAX_PER_USER}), deferring download from ${username}`, {
      username,
      active: activeFromUser?.count,
      filename,
    });
    // Put the job back to queued with lower priority — it'll be picked up
    // after other jobs run and slots free up from this user
    db.update(schema.jobs)
      .set({
        status: "queued",
        startedAt: null,
        priority: Math.max(0, (job.priority ?? 0) - 1),
      })
      .where(eq(schema.jobs.id, job.id))
      .run();
    return; // Exit without calling completeJob — job is back in the queue
  }

  // Record download state
  const downloadRow = db
    .insert(schema.downloads)
    .values({
      trackId: payload.trackId,
      playlistId: payload.playlistId,
      status: "downloading",
      soulseekPath: filename,
      slskdUsername: username,
      slskdFilename: filename,
      sourceId: "soulseek",
      sourceKey: `${username}:${filename}`,
      startedAt: Date.now(),
    })
    .returning()
    .get();

  // Look up playlist name
  const playlist = await db.query.playlists.findFirst({
    where: eq(schema.playlists.id, payload.playlistId),
  });
  const playlistName = playlist?.name ?? "Unknown";

  const downloadService = DownloadService.fromDb(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
  );

  const soulseek = new SoulseekService(config.soulseek);

  const track = {
    title: payload.title,
    artist: payload.artist,
    album: payload.album,
    durationMs: payload.durationMs,
  };

  const slskdFile = {
    filename,
    size,
    username,
    bitRate: payload.file.bitRate,
    sampleRate: undefined as number | undefined,
    bitDepth: undefined as number | undefined,
    length: undefined as number | undefined,
    code: "1",
  };

  // 1. Initiate the download via slskd API (fire-and-forget)
  try {
    await soulseek.download(username, filename, size);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to initiate download, may already be queued`, { filename, error: message });
    // Don't fail — the file might already be downloading or completed from a previous attempt
  }

  // 2. Check if file already exists on disk (from a previous run or fast transfer)
  const tempPath = downloadService.findDownloadedFile(username, filename);

  if (tempPath) {
    log.debug(`File already on disk, validating immediately`, { filename, tempPath });

    const valid = await downloadService.validateDownload(tempPath, track, payload.trackId, slskdFile);
    if (valid) {
      const finalPath = downloadService.moveToPlaylistFolder(tempPath, playlistName, track);

      db.update(schema.downloads)
        .set({
          status: "done",
          filePath: finalPath,
          completedAt: Date.now(),
        })
        .where(eq(schema.downloads.id, downloadRow.id))
        .run();

      completeJob(job.id, {
        trackId: payload.trackId,
        filePath: finalPath,
        strategy: payload.strategy,
        immediate: true,
      });
      return;
    }

    // Validation failed — but we already recorded the rejection in validateDownload.
    // Leave the download as "downloading" so the scanner can check for the next file,
    // or it will time out and auto-retry.
    log.debug(`File on disk failed validation, leaving for scanner`, { filename });
  }

  // 3. File not found or validation failed — leave status as "downloading"
  //    The background download scanner will pick it up.
  log.debug(`Download initiated, scanner will handle completion`, {
    filename,
    username,
    downloadId: downloadRow.id,
  });

  completeJob(job.id, {
    trackId: payload.trackId,
    downloadId: downloadRow.id,
    strategy: payload.strategy,
    status: "downloading",
  });
}
