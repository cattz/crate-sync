import {
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, join, basename, dirname } from "node:path";
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
import { createLogger } from "../utils/logger.js";
import { generateSearchQueries, type QueryStrategy } from "../search/query-builder.js";

const log = createLogger("download");

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
  /** Which query strategy succeeded (if any). */
  strategy?: string;
  /** All strategies tried and their result counts. */
  strategyLog?: Array<{ label: string; query: string; resultCount: number }>;
}

/** Info passed to the download review callback. */
export interface DownloadCandidate {
  track: TrackInfo;
  file: SlskdFile;
  /** Parsed artist/title from the Soulseek filename. */
  parsedTrack: TrackInfo;
  score: number;
  diagnostics: string;
}

/**
 * Review callback for download candidates.
 * Return true to accept, false to skip.
 * Returning "all" accepts this and all remaining without further prompts.
 */
export type DownloadReviewFn = (
  candidate: DownloadCandidate,
  index: number,
  total: number,
) => Promise<boolean | "all">;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove characters that are unsafe in file/directory names. */
function sanitize(name: string): string {
  return name
    .replace(/[/:*?"<>|\\]/g, " ")
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
  private readonly slskdDownloadDir: string;

  constructor(
    private soulseekConfig: SoulseekConfig,
    private downloadConfig: DownloadConfig,
    private lexiconConfig: LexiconConfig,
  ) {
    this.soulseek = new SoulseekService(soulseekConfig);
    this.matcher = new FuzzyMatchStrategy({
      autoAcceptThreshold: 0.9,
      reviewThreshold: 0.7,
      context: "soulseek",
      artistRejectThreshold: 0.3,
    });
    this.allowedFormats = new Set(
      downloadConfig.formats.map((f) => f.toLowerCase()),
    );
    this.minBitrate = downloadConfig.minBitrate;
    this.concurrency = downloadConfig.concurrency;
    this.downloadRoot = lexiconConfig.downloadRoot;
    this.slskdDownloadDir = soulseekConfig.downloadDir;
  }

  /**
   * Filter by format/bitrate and rank files using fuzzy matching.
   * Pure function — no I/O.
   */
  rankResults(
    files: SlskdFile[],
    track: TrackInfo,
  ): { ranked: RankedResult[]; diagnostics: string } {
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
    let artistRejected = 0;

    for (const file of bitrateFiltered) {
      const candidate = trackInfoFromFilename(file.filename);

      // Pass duration info from soulseek file metadata if available
      if (file.length != null) {
        candidate.durationMs = file.length * 1000;
      }

      const matches = this.matcher.match(expected, [candidate]);
      if (matches.length > 0) {
        ranked.push({ file, score: matches[0].score });
      } else {
        artistRejected++;
      }
    }

    // Sort by score descending
    ranked.sort((a, b) => b.score - a.score);

    // Build diagnostics
    const diag = [
      `${files.length} results`,
      files.length - formatFiltered.length > 0 ? `${files.length - formatFiltered.length} filtered by format` : null,
      formatFiltered.length - bitrateFiltered.length > 0 ? `${formatFiltered.length - bitrateFiltered.length} filtered by bitrate (<${this.minBitrate}kbps)` : null,
      artistRejected > 0 ? `${artistRejected} rejected by artist mismatch` : null,
      `${ranked.length} candidates`,
    ].filter(Boolean).join(", ");

    return { ranked, diagnostics: diag };
  }

  /**
   * Search Soulseek for a track using multi-strategy query builder.
   * Tries strategies in order, stopping at the first that returns results.
   */
  async searchAndRank(track: TrackInfo): Promise<{
    ranked: RankedResult[];
    diagnostics: string;
    strategy?: string;
    strategyLog: Array<{ label: string; query: string; resultCount: number }>;
  }> {
    const strategies = generateSearchQueries(track);
    const strategyLog: Array<{ label: string; query: string; resultCount: number }> = [];

    for (const strategy of strategies) {
      log.debug(`Searching Soulseek [${strategy.label}]`, { query: strategy.query });
      const files = await this.soulseek.rateLimitedSearch(strategy.query);
      log.debug(`Search returned ${files.length} files [${strategy.label}]`, { query: strategy.query });

      const result = this.rankResults(files, track);
      strategyLog.push({ label: strategy.label, query: strategy.query, resultCount: result.ranked.length });

      if (result.ranked.length > 0) {
        log.debug(`Strategy "${strategy.label}" succeeded`, {
          query: strategy.query,
          candidates: result.ranked.length,
        });

        // Log top candidates for debugging
        for (const r of result.ranked.slice(0, 5)) {
          const cand = trackInfoFromFilename(r.file.filename);
          log.debug(`Candidate`, {
            score: r.score,
            filename: r.file.filename,
            parsedTitle: cand.title,
            parsedArtist: cand.artist,
            bitrate: r.file.bitRate,
            username: r.file.username,
          });
        }

        return { ...result, strategy: strategy.label, strategyLog };
      }

      log.debug(`Strategy "${strategy.label}" returned 0 candidates, trying next`, {
        query: strategy.query,
        total: files.length,
      });
    }

    // All strategies exhausted
    const lastDiag = `0 results across ${strategies.length} strategies`;
    return { ranked: [], diagnostics: lastDiag, strategyLog };
  }

  /**
   * Ensure the playlist destination folder exists under downloadRoot.
   * Called early in the sync so the folder is visible in Lexicon/Incoming
   * even before any downloads complete.
   */
  ensurePlaylistFolder(playlistName: string): string {
    const destDir = join(this.downloadRoot, sanitize(playlistName));
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    return destDir;
  }

  /**
   * Batch search: POST all searches upfront using strategy 1, poll all
   * concurrently, then rank. Tracks with 0 results fall back to sequential
   * multi-strategy search.
   */
  async searchAndRankBatch(
    tracks: Array<{ track: TrackInfo; dbTrackId: string }>,
  ): Promise<Map<string, { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<{ label: string; query: string; resultCount: number }> }>> {
    // Build first-strategy queries for batch
    const queryToTrack = new Map<string, { track: TrackInfo; dbTrackId: string }>();

    for (const item of tracks) {
      const strategies = generateSearchQueries(item.track);
      const query = strategies[0]?.query ?? `${item.track.artist} ${item.track.title}`;
      queryToTrack.set(query, item);
    }

    const queries = [...queryToTrack.keys()];
    log.debug(`Starting batch search`, { count: queries.length });

    // POST all searches with rate-limit delays
    const searchEntries = await this.soulseek.startSearchBatch(queries);
    log.debug(`All searches posted, polling for results`);

    // Poll all searches in a single loop
    const searchResults = await this.soulseek.waitForSearchBatch(searchEntries);

    // Rank results for each track
    const results = new Map<string, { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<{ label: string; query: string; resultCount: number }> }>();
    const needsFallback: Array<{ track: TrackInfo; dbTrackId: string }> = [];

    for (const [query, item] of queryToTrack) {
      const files = searchResults.get(query) ?? [];
      log.debug(`Batch search results`, { query, fileCount: files.length });
      const rankResult = this.rankResults(files, item.track);

      if (rankResult.ranked.length > 0) {
        results.set(item.dbTrackId, {
          ...rankResult,
          strategy: "full",
          strategyLog: [{ label: "full", query, resultCount: rankResult.ranked.length }],
        });
      } else {
        needsFallback.push(item);
      }
    }

    // Fallback: try remaining strategies sequentially for tracks with 0 results
    for (const item of needsFallback) {
      log.debug(`Batch fallback: trying additional strategies`, {
        title: item.track.title,
        artist: item.track.artist,
      });
      const result = await this.searchAndRank(item.track);
      results.set(item.dbTrackId, result);
    }

    return results;
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
      // 0. Ensure playlist folder exists
      this.ensurePlaylistFolder(playlistName);

      // 1. Search and rank
      const { ranked, diagnostics, strategy, strategyLog } = await this.searchAndRank(track);

      if (ranked.length === 0) {
        return {
          trackId: dbTrackId,
          success: false,
          error: `No matching files on Soulseek (${diagnostics})`,
          strategyLog,
        };
      }

      // 2. Download best match
      const best = ranked[0];

      if (best.score < 0.3) {
        return {
          trackId: dbTrackId,
          success: false,
          error: `Best match score too low: ${(best.score * 100).toFixed(0)}% — "${best.file.filename}" (${diagnostics})`,
          strategy,
          strategyLog,
        };
      }

      const result = await this.acquireAndMove(best.file, track, playlistName, dbTrackId);
      return { ...result, strategy, strategyLog };
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
   * Download multiple tracks: batch search all at once, then download concurrently.
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
    onReview?: DownloadReviewFn,
  ): Promise<DownloadResult[]> {
    const total = tracks.length;
    const results: DownloadResult[] = [];
    let completed = 0;

    if (total === 0) {
      return results;
    }

    // 0. Create playlist folders upfront so they're visible in Lexicon/Incoming
    const playlistNames = new Set(tracks.map((t) => t.playlistName));
    for (const name of playlistNames) {
      this.ensurePlaylistFolder(name);
    }

    // 1. Batch search all tracks at once
    const batchInput = tracks.map((item) => ({
      track: item.track,
      dbTrackId: item.dbTrackId,
    }));
    const searchResults = await this.searchAndRankBatch(batchInput);

    // 2. Review candidates if callback provided
    const approved = new Set<string>(); // dbTrackIds approved for download
    const rejected = new Set<string>(); // dbTrackIds rejected by user
    let autoAcceptAll = false;

    if (onReview) {
      const reviewable = tracks.filter((item) => {
        const sr = searchResults.get(item.dbTrackId);
        return sr && sr.ranked.length > 0 && sr.ranked[0].score >= 0.3;
      });

      for (let i = 0; i < reviewable.length; i++) {
        const item = reviewable[i];
        const sr = searchResults.get(item.dbTrackId)!;
        const best = sr.ranked[0];

        if (autoAcceptAll) {
          approved.add(item.dbTrackId);
          continue;
        }

        const decision = await onReview(
          {
            track: item.track,
            file: best.file,
            parsedTrack: trackInfoFromFilename(best.file.filename),
            score: best.score,
            diagnostics: sr.diagnostics,
          },
          i,
          reviewable.length,
        );

        if (decision === "all") {
          autoAcceptAll = true;
          approved.add(item.dbTrackId);
        } else if (decision) {
          approved.add(item.dbTrackId);
        } else {
          rejected.add(item.dbTrackId);
        }
      }
    }

    // 3. Download approved matches concurrently
    const pending = new Set<Promise<void>>();

    for (const item of tracks) {
      if (isShutdownRequested()) {
        break;
      }

      // If review was used, skip non-approved tracks
      if (onReview && rejected.has(item.dbTrackId)) {
        const result: DownloadResult = {
          trackId: item.dbTrackId,
          success: false,
          error: "Rejected during review",
        };
        results.push(result);
        completed++;
        onProgress?.(completed, total, result);
        continue;
      }

      const task = this.downloadFromSearchResults(
        item.track,
        item.playlistName,
        item.dbTrackId,
        searchResults.get(item.dbTrackId),
      ).then((result) => {
        results.push(result);
        completed++;
        onProgress?.(completed, total, result);
      });

      pending.add(task);
      task.finally(() => pending.delete(task));

      if (pending.size >= this.concurrency) {
        await Promise.race(pending);
      }
    }

    await Promise.all(pending);

    return results;
  }

  /**
   * Download a single track given pre-computed search results.
   * Used by downloadBatch after batch search completes.
   */
  private async downloadFromSearchResults(
    track: TrackInfo,
    playlistName: string,
    dbTrackId: string,
    searchResult?: { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<{ label: string; query: string; resultCount: number }> },
  ): Promise<DownloadResult> {
    try {
      const ranked = searchResult?.ranked ?? [];
      const diagnostics = searchResult?.diagnostics ?? "no search results";
      const strategy = searchResult?.strategy;
      const strategyLog = searchResult?.strategyLog;

      if (ranked.length === 0) {
        return {
          trackId: dbTrackId,
          success: false,
          error: `No matching files on Soulseek (${diagnostics})`,
          strategyLog,
        };
      }

      const best = ranked[0];

      if (best.score < 0.3) {
        return {
          trackId: dbTrackId,
          success: false,
          error: `Best match score too low: ${(best.score * 100).toFixed(0)}% — "${best.file.filename}" (${diagnostics})`,
          strategy,
          strategyLog,
        };
      }

      const result = await this.acquireAndMove(best.file, track, playlistName, dbTrackId);
      return { ...result, strategy, strategyLog };
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
   * Validate a downloaded file's audio metadata against expected track info.
   * Uses music-metadata to parse tags, then fuzzy-matches artist + title.
   * Returns true if score > 0.5 (lenient — tags are often messy).
   */
  /**
   * Check if file already exists in slskd downloads, otherwise download it.
   * Then validate and move to playlist folder.
   */
  async acquireAndMove(
    file: SlskdFile,
    track: TrackInfo,
    playlistName: string,
    dbTrackId: string,
  ): Promise<DownloadResult> {
    try {
      const { username, filename, size } = file;

      // Check if the file already exists from a previous run
      let tempPath = this.findDownloadedFile(username, filename);

      if (tempPath) {
        log.debug(`File already in downloads, skipping download`, { filename, tempPath });
      } else {
        await this.soulseek.download(username, filename, size);
        await this.soulseek.waitForDownload(username, filename);

        tempPath = this.findDownloadedFile(username, filename);
        if (!tempPath) {
          return {
            trackId: dbTrackId,
            success: false,
            error: `Downloaded file not found in slskd download dir for: ${filename}`,
          };
        }
      }

      const valid = await this.validateDownload(tempPath, track);
      if (!valid) {
        return {
          trackId: dbTrackId,
          success: false,
          filePath: tempPath,
          error: "Downloaded file failed metadata validation",
        };
      }

      const finalPath = this.moveToPlaylistFolder(tempPath, playlistName, track);
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
   * Find the local file that slskd downloaded.
   * slskd strips the @@share prefix and may append a unique suffix to avoid
   * overwrites (e.g. "file_639091878895823617.mp3"). We search the expected
   * directory for the most recent file matching the base name.
   */
  private findDownloadedFile(_username: string, filename: string): string | null {
    // Strip the @@xxx\ share prefix
    const withoutShare = filename.replace(/^@@[^\\\/]+[\\\/]/, "");
    const normalized = withoutShare.replaceAll("\\", "/");
    const expectedPath = join(this.slskdDownloadDir, normalized);

    // Try exact match first
    if (existsSync(expectedPath)) {
      return expectedPath;
    }

    // Search for suffixed variants: <name>_<id>.<ext>
    const dir = dirname(expectedPath);
    const ext = extname(expectedPath);
    const base = basename(expectedPath, ext);

    if (!existsSync(dir)) {
      return null;
    }

    const candidates = readdirSync(dir)
      .filter((f) => f.startsWith(base) && f.endsWith(ext))
      .map((f) => join(dir, f))
      .sort((a, b) => {
        // Most recently modified first
        try {
          return statSync(b).mtimeMs - statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });

    return candidates[0] ?? null;
  }
}
