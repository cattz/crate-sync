import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import { completeJob } from "../runner.js";

interface ValidatePayload {
  trackId: string;
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

/**
 * Post-download validation: verify audio metadata matches expected track.
 */
export async function handleValidate(job: Job, config: Config): Promise<void> {
  const payload: ValidatePayload = JSON.parse(job.payload ?? "{}");

  const downloadService = new DownloadService(
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

  const valid = await downloadService.validateDownload(payload.filePath, track);

  if (!valid) {
    throw new Error(`File failed metadata validation: ${payload.filePath}`);
  }

  completeJob(job.id, { trackId: payload.trackId, valid: true });
}
