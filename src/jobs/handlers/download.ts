import { eq } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import { completeJob, createJob } from "../runner.js";

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
 * Download a single track via acquireAndMove, then create a validate job.
 */
export async function handleDownload(job: Job, config: Config): Promise<void> {
  const payload: DownloadPayload = JSON.parse(job.payload ?? "{}");
  const db = getDb();

  // Record download state: searching → downloading
  const downloadRow = db
    .insert(schema.downloads)
    .values({
      trackId: payload.trackId,
      playlistId: payload.playlistId,
      status: "downloading",
      soulseekPath: payload.file.filename,
      startedAt: Date.now(),
    })
    .returning()
    .get();

  // Look up playlist name
  const playlist = await db.query.playlists.findFirst({
    where: eq(schema.playlists.id, payload.playlistId),
  });
  const playlistName = playlist?.name ?? "Unknown";

  const downloadService = new DownloadService(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
  );

  const track = {
    title: payload.title,
    artist: payload.artist,
    album: payload.album,
    durationMs: payload.durationMs,
  };

  const slskdFile = {
    filename: payload.file.filename,
    size: payload.file.size,
    username: payload.file.username,
    bitRate: payload.file.bitRate,
    sampleRate: undefined as number | undefined,
    bitDepth: undefined as number | undefined,
    length: undefined as number | undefined,
    code: "1",
  };

  // Use acquireAndMove which handles download, validate, and move
  const result = await downloadService.acquireAndMove(
    slskdFile,
    track,
    playlistName,
    payload.trackId,
  );

  if (result.success) {
    db.update(schema.downloads)
      .set({
        status: "done",
        filePath: result.filePath,
        completedAt: Date.now(),
      })
      .where(eq(schema.downloads.id, downloadRow.id))
      .run();

    completeJob(job.id, {
      trackId: payload.trackId,
      filePath: result.filePath,
      strategy: payload.strategy,
    });
  } else {
    db.update(schema.downloads)
      .set({
        status: "failed",
        error: result.error,
        completedAt: Date.now(),
      })
      .where(eq(schema.downloads.id, downloadRow.id))
      .run();

    throw new Error(result.error ?? "Download failed");
  }
}
