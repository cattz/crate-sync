import { eq, sql } from "drizzle-orm";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import { FuzzyMatchStrategy } from "../../matching/fuzzy.js";
import { completeJob } from "../runner.js";
import { createLogger } from "../../utils/logger.js";
import type { TrackInfo } from "../../types/common.js";

const log = createLogger("orphan-rescue");

const AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".wav", ".ogg", ".m4a"]);

/**
 * Parse artist/title from a filename.
 * Strips extension, leading track numbers, then splits on " - ".
 */
function trackInfoFromFilename(filename: string): TrackInfo {
  const base = basename(filename, extname(filename));
  // Strip leading track numbers like "01 - ", "01. ", "1-", etc.
  const cleaned = base.replace(/^\d+[\s.\-_]*[-.]?\s*/, "");

  const dashIdx = cleaned.indexOf(" - ");
  if (dashIdx !== -1) {
    return {
      artist: cleaned.slice(0, dashIdx).trim(),
      title: cleaned.slice(dashIdx + 3).trim(),
    };
  }

  // Fallback: use the full cleaned name as title
  return { title: cleaned.trim(), artist: "" };
}

/**
 * Recursively collect all audio files under a directory.
 */
function collectAudioFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  function walk(current: string) {
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (AUDIO_EXTENSIONS.has(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // ignore permission errors etc.
    }
  }

  walk(dir);
  return results;
}

/**
 * Rescue orphan downloads from the slskd download directory.
 *
 * Scans for audio files that aren't tracked, then tries to match them
 * against downloading records or wishlisted/failed tracks using fuzzy matching.
 */
export async function handleOrphanRescue(job: Job, config: Config): Promise<void> {
  const db = getDb();
  const downloadDir = config.soulseek.downloadDir;

  if (!downloadDir || !existsSync(downloadDir)) {
    completeJob(job.id, { error: "Download directory not configured or not found" });
    return;
  }

  const downloadService = DownloadService.fromDb(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
    config.matching,
  );

  // Collect all audio files recursively
  const allFiles = collectAudioFiles(downloadDir);
  log.info(`Found ${allFiles.length} audio files in ${downloadDir}`);

  if (allFiles.length === 0) {
    completeJob(job.id, { scanned: 0, rescued: 0, unmatched: 0, errors: 0 });
    return;
  }

  // Build set of file paths that are already tracked as "done" downloads
  const doneDownloads = db
    .select({ filePath: schema.downloads.filePath })
    .from(schema.downloads)
    .where(eq(schema.downloads.status, "done"))
    .all();
  const doneFilePaths = new Set(
    doneDownloads.map((d) => d.filePath).filter(Boolean),
  );

  // Also build set of files in playlist-named folders (managed by destination feature)
  const downloadRoot = config.lexicon.downloadRoot;
  const managedPrefixes: string[] = [];
  if (downloadRoot && existsSync(downloadRoot)) {
    try {
      const entries = readdirSync(downloadRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          managedPrefixes.push(join(downloadRoot, entry.name) + "/");
        }
      }
    } catch {
      // ignore
    }
  }

  // Build fuzzy matcher for orphan matching (lower threshold for rescue)
  const matcher = new FuzzyMatchStrategy({
    autoAcceptThreshold: 0.9,
    reviewThreshold: 0.7,
    context: "soulseek",
    weights: config.matching?.soulseekWeights,
    artistRejectThreshold: 0.3,
  });

  let rescued = 0;
  let unmatched = 0;
  let errors = 0;
  let skipped = 0;

  for (const filePath of allFiles) {
    try {
      // Skip files already tracked as done
      if (doneFilePaths.has(filePath)) {
        skipped++;
        continue;
      }

      // Skip files inside the managed download root (playlist folders)
      if (managedPrefixes.some((prefix) => filePath.startsWith(prefix))) {
        skipped++;
        continue;
      }

      const fileBasename = basename(filePath);

      // Strategy A: Check downloading records by filename match
      const downloadingRecords = db
        .select()
        .from(schema.downloads)
        .where(eq(schema.downloads.status, "downloading"))
        .all();

      let matchedDownload = false;
      for (const dl of downloadingRecords) {
        if (dl.slskdFilename && basename(dl.slskdFilename) === fileBasename) {
          // Found a match — validate and move
          const track = db
            .select()
            .from(schema.tracks)
            .where(eq(schema.tracks.id, dl.trackId))
            .get();

          if (!track) continue;

          const playlist = dl.playlistId
            ? db.query.playlists.findFirst({
                where: eq(schema.playlists.id, dl.playlistId),
              })
            : undefined;
          const playlistName = (await playlist)?.name ?? "Unknown";

          const trackInfo: TrackInfo = {
            title: track.title,
            artist: track.artist,
            album: track.album ?? undefined,
            durationMs: track.durationMs,
          };

          // Check if stable
          const stable = await downloadService.checkFileStable(filePath, 3000);
          if (!stable) continue;

          const finalPath = downloadService.moveToPlaylistFolder(filePath, playlistName, trackInfo);

          db.update(schema.downloads)
            .set({
              status: "done",
              filePath: finalPath,
              completedAt: Date.now(),
            })
            .where(eq(schema.downloads.id, dl.id))
            .run();

          log.info(`Rescued orphan (downloading match)`, {
            trackId: dl.trackId,
            title: track.title,
            artist: track.artist,
            finalPath,
          });

          rescued++;
          matchedDownload = true;
          break;
        }
      }

      if (matchedDownload) continue;

      // Strategy B: Fuzzy match against wishlisted or failed tracks
      const parsed = trackInfoFromFilename(filePath);
      if (!parsed.title) {
        unmatched++;
        continue;
      }

      // Query tracks that have wishlisted or failed downloads
      const candidates = db
        .select({
          trackId: schema.tracks.id,
          title: schema.tracks.title,
          artist: schema.tracks.artist,
          album: schema.tracks.album,
          durationMs: schema.tracks.durationMs,
          downloadId: schema.downloads.id,
          playlistId: schema.downloads.playlistId,
          downloadStatus: schema.downloads.status,
        })
        .from(schema.downloads)
        .innerJoin(schema.tracks, eq(schema.downloads.trackId, schema.tracks.id))
        .where(
          sql`${schema.downloads.status} IN ('wishlisted', 'failed')`,
        )
        .all();

      if (candidates.length === 0) {
        unmatched++;
        log.debug(`No wishlisted/failed candidates for orphan`, { filePath, parsed });
        continue;
      }

      // Build TrackInfo array for fuzzy matching
      const candidateInfos: Array<TrackInfo & { _idx: number }> = candidates.map((c, idx) => ({
        title: c.title,
        artist: c.artist,
        album: c.album ?? undefined,
        durationMs: c.durationMs,
        _idx: idx,
      }));

      const matchResults = matcher.match(
        parsed,
        candidateInfos,
      );

      if (matchResults.length === 0 || matchResults[0].score < 0.7) {
        unmatched++;
        log.debug(`No fuzzy match for orphan`, {
          filePath,
          parsed,
          bestScore: matchResults[0]?.score,
        });
        continue;
      }

      const bestMatch = matchResults[0];
      // Find which candidate matched
      const matchedCandidate = candidateInfos.find(
        (c) =>
          c.title === bestMatch.candidate.title &&
          c.artist === bestMatch.candidate.artist,
      );

      if (!matchedCandidate) {
        unmatched++;
        continue;
      }

      const matched = candidates[matchedCandidate._idx];

      // Look up playlist name
      const playlist = matched.playlistId
        ? db.query.playlists.findFirst({
            where: eq(schema.playlists.id, matched.playlistId),
          })
        : undefined;
      const playlistName = (await playlist)?.name ?? "Unknown";

      const trackInfo: TrackInfo = {
        title: matched.title,
        artist: matched.artist,
        album: matched.album ?? undefined,
        durationMs: matched.durationMs,
      };

      // Check if stable
      const stable = await downloadService.checkFileStable(filePath, 3000);
      if (!stable) {
        log.debug(`Orphan file not stable, skipping`, { filePath });
        continue;
      }

      // Move to playlist folder
      const finalPath = downloadService.moveToPlaylistFolder(filePath, playlistName, trackInfo);

      // Update download record
      db.update(schema.downloads)
        .set({
          status: "done",
          filePath: finalPath,
          completedAt: Date.now(),
        })
        .where(eq(schema.downloads.id, matched.downloadId))
        .run();

      log.info(`Rescued orphan (fuzzy match, score=${bestMatch.score.toFixed(2)})`, {
        trackId: matched.trackId,
        title: matched.title,
        artist: matched.artist,
        parsedTitle: parsed.title,
        parsedArtist: parsed.artist,
        finalPath,
      });

      rescued++;
    } catch (err) {
      errors++;
      log.error(`Error processing orphan file`, {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Clean up empty directories after rescue
  const dirsRemoved = downloadService.cleanupEmptyDirs();
  if (dirsRemoved > 0) {
    log.info(`Cleaned up ${dirsRemoved} empty directories after rescue`);
  }

  const result = {
    scanned: allFiles.length,
    rescued,
    unmatched,
    skipped,
    errors,
    dirsRemoved,
  };

  log.info(`Orphan rescue complete`, result);
  completeJob(job.id, result);
}
