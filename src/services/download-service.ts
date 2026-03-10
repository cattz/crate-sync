import {
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { extname, join, basename } from "node:path";
import { parseFile } from "music-metadata";

import type {
  SoulseekConfig,
  DownloadConfig,
  LexiconConfig,
} from "../config.js";
import type { TrackInfo } from "../types/common.js";
import type { SlskdFile } from "../types/soulseek.js";
import { SoulseekService } from "./soulseek-service.js";
import { FuzzyMatchStrategy } from "../matching/fuzzy.js";
import { isShutdownRequested } from "../utils/shutdown.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankedResult {
  file: SlskdFile;
  score: number;
}

export interface DownloadResult {
  trackId: string;
  success: boolean;
  filePath?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove characters that are unsafe in file/directory names. */
function sanitize(name: string): string {
  return name
    .replace(/[/:*?"<>|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a Soulseek filename into a TrackInfo for matching purposes.
 * Filenames typically look like:
 *   @@user\music\Artist\Album\01 - Title.flac
 * We take the last path segment, strip extension and track numbers,
 * then try to split on " - " for Artist - Title.
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

/** Get the file extension (lowercase, without dot) from a filename. */
function getExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

// ---------------------------------------------------------------------------
// DownloadService
// ---------------------------------------------------------------------------

export class DownloadService {
  private readonly soulseek: SoulseekService;
  private readonly matcher: FuzzyMatchStrategy;
  private readonly allowedFormats: Set<string>;
  private readonly minBitrate: number;
  private readonly concurrency: number;
  private readonly downloadRoot: string;

  constructor(
    private soulseekConfig: SoulseekConfig,
    private downloadConfig: DownloadConfig,
    private lexiconConfig: LexiconConfig,
  ) {
    this.soulseek = new SoulseekService(soulseekConfig);
    this.matcher = new FuzzyMatchStrategy({
      autoAcceptThreshold: 0.9,
      reviewThreshold: 0.7,
    });
    this.allowedFormats = new Set(
      downloadConfig.formats.map((f) => f.toLowerCase()),
    );
    this.minBitrate = downloadConfig.minBitrate;
    this.concurrency = downloadConfig.concurrency;
    this.downloadRoot = lexiconConfig.downloadRoot;
  }

  /**
   * Search Soulseek for a track, filter by format/bitrate, and rank results
   * using fuzzy matching against the expected artist + title.
   */
  async searchAndRank(track: TrackInfo): Promise<RankedResult[]> {
    const query = `${track.artist} ${track.title}`;
    const files = await this.soulseek.rateLimitedSearch(query);

    // Filter by allowed formats
    const formatFiltered = files.filter((f) =>
      this.allowedFormats.has(getExtension(f.filename)),
    );

    // Filter by minimum bitrate (skip check for files without bitrate info)
    const bitrateFiltered = formatFiltered.filter(
      (f) => f.bitRate == null || f.bitRate >= this.minBitrate,
    );

    // Rank using fuzzy matching: build TrackInfo from each filename and compare
    const expected: TrackInfo = {
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs,
    };

    const ranked: RankedResult[] = [];

    for (const file of bitrateFiltered) {
      const candidate = trackInfoFromFilename(file.filename);

      // Pass duration info from soulseek file metadata if available
      if (file.length != null) {
        candidate.durationMs = file.length * 1000;
      }

      const matches = this.matcher.match(expected, [candidate]);
      const score = matches.length > 0 ? matches[0].score : 0;

      ranked.push({ file, score });
    }

    // Sort by score descending
    ranked.sort((a, b) => b.score - a.score);

    return ranked;
  }

  /**
   * Download a single track: search -> rank -> download best -> validate -> move.
   */
  async downloadTrack(
    track: TrackInfo,
    playlistName: string,
    dbTrackId: string,
  ): Promise<DownloadResult> {
    try {
      // 1. Search and rank
      const ranked = await this.searchAndRank(track);

      if (ranked.length === 0) {
        return {
          trackId: dbTrackId,
          success: false,
          error: "No matching files found on Soulseek",
        };
      }

      // 2. Download best match
      const best = ranked[0];
      const { username, filename, size } = best.file;

      await this.soulseek.download(username, filename, size);

      // 3. Wait for download to complete
      await this.soulseek.waitForDownload(username, filename);

      // Build temp path where slskd stores the downloaded file
      const tempPath = this.buildTempPath(username, filename);

      // 4. Validate downloaded file metadata
      const valid = await this.validateDownload(tempPath, track);

      if (!valid) {
        return {
          trackId: dbTrackId,
          success: false,
          filePath: tempPath,
          error: "Downloaded file failed metadata validation",
        };
      }

      // 5. Move to playlist folder
      const finalPath = this.moveToPlaylistFolder(
        tempPath,
        playlistName,
        track,
      );

      return {
        trackId: dbTrackId,
        success: true,
        filePath: finalPath,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        trackId: dbTrackId,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Download multiple tracks concurrently (respects download concurrency config).
   * Searches are rate-limited via rateLimitedSearch, downloads run concurrently.
   */
  async downloadBatch(
    tracks: Array<{
      track: TrackInfo;
      playlistName: string;
      dbTrackId: string;
    }>,
    onProgress?: (
      completed: number,
      total: number,
      result: DownloadResult,
    ) => void,
  ): Promise<DownloadResult[]> {
    const total = tracks.length;
    const results: DownloadResult[] = [];
    let completed = 0;

    if (total === 0) {
      return results;
    }

    // Promise-pool pattern: maintain up to `concurrency` in-flight downloads
    const pending = new Set<Promise<void>>();

    for (const item of tracks) {
      if (isShutdownRequested()) {
        break;
      }

      const task = this.downloadTrack(
        item.track,
        item.playlistName,
        item.dbTrackId,
      ).then((result) => {
        results.push(result);
        completed++;
        onProgress?.(completed, total, result);
      });

      pending.add(task);
      task.finally(() => pending.delete(task));

      // When we hit the concurrency limit, wait for one to finish
      if (pending.size >= this.concurrency) {
        await Promise.race(pending);
      }
    }

    // Wait for remaining downloads
    await Promise.all(pending);

    return results;
  }

  /**
   * Validate a downloaded file's audio metadata against expected track info.
   * Uses music-metadata to parse tags, then fuzzy-matches artist + title.
   * Returns true if score > 0.5 (lenient — tags are often messy).
   */
  async validateDownload(
    filePath: string,
    expected: TrackInfo,
  ): Promise<boolean> {
    try {
      const metadata = await parseFile(filePath);
      const { common } = metadata;

      const tagTrack: TrackInfo = {
        title: common.title ?? "",
        artist: common.artist ?? "",
        album: common.album ?? undefined,
        durationMs: metadata.format.duration
          ? Math.round(metadata.format.duration * 1000)
          : undefined,
      };

      const matches = this.matcher.match(expected, [tagTrack]);
      return matches.length > 0 && matches[0].score > 0.5;
    } catch {
      // If we can't parse metadata, treat as invalid
      return false;
    }
  }

  /**
   * Move a validated file to its final location:
   * <downloadRoot>/<playlistName>/<Artist> - <Title>.<ext>
   */
  moveToPlaylistFolder(
    tempPath: string,
    playlistName: string,
    track: TrackInfo,
  ): string {
    const ext = getExtension(tempPath);
    const safeName = `${sanitize(track.artist)} - ${sanitize(track.title)}`;
    const destDir = join(this.downloadRoot, sanitize(playlistName));
    const destPath = join(destDir, `${safeName}.${ext}`);

    // Create directory if needed
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Try rename first (same filesystem), fall back to copy+delete (cross-device)
    try {
      renameSync(tempPath, destPath);
    } catch {
      copyFileSync(tempPath, destPath);
      unlinkSync(tempPath);
    }

    return destPath;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the expected local path where slskd stores a downloaded file.
   * slskd stores files under its download directory by username and filename.
   * We place them in a .downloads staging area under the download root.
   */
  private buildTempPath(username: string, filename: string): string {
    const base = basename(filename);
    return join(this.downloadRoot, ".downloads", username, base);
  }
}
