import {
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
  statSync,
  rmdirSync,
} from "node:fs";
import { extname, join, basename, dirname } from "node:path";
import { parseFile } from "music-metadata";
import crypto from "node:crypto";
import type {
  SoulseekConfig,
  DownloadConfig,
  LexiconConfig,
  MatchingConfig,
} from "../config.js";
import type { TrackInfo } from "../types/common.js";
import type { SlskdFile } from "../types/soulseek.js";
import type { IRejectionRepository } from "../ports/repositories.js";
import { SoulseekService } from "./soulseek-service.js";
import { FuzzyMatchStrategy } from "../matching/fuzzy.js";
import { isShutdownRequested } from "../utils/shutdown.js";
import { createLogger } from "../utils/logger.js";
import { generateSearchQueries, type QueryStrategy } from "../search/query-builder.js";
import { getDb } from "../db/client.js";
import { DrizzleRejectionRepository } from "../db/repositories/index.js";

const log = createLogger("download");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Database = ReturnType<typeof getDb>;

export type ValidationStrictness = "strict" | "moderate" | "lenient";

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

export interface DownloadItem {
  track: TrackInfo;
  dbTrackId: string;
  playlistName: string;
}

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

/** Build a rejection file_key from a Soulseek file's username and filepath. */
function buildFileKey(username: string, filepath: string): string {
  return `${username}:${filepath}`;
}

// ---------------------------------------------------------------------------
// DownloadService
// ---------------------------------------------------------------------------

export class DownloadService {
  private readonly rejections: IRejectionRepository;
  private readonly soulseek: SoulseekService;
  private readonly matcher: FuzzyMatchStrategy;
  private readonly allowedFormats: Set<string>;
  private readonly minBitrate: number;
  private readonly concurrency: number;
  private readonly downloadRoot: string;
  private readonly slskdDownloadDir: string;
  private readonly validationStrictness: ValidationStrictness;

  /** Create a DownloadService from a raw DB handle (convenience factory). */
  static fromDb(
    db: Database,
    soulseekConfig: SoulseekConfig,
    downloadConfig: DownloadConfig,
    lexiconConfig: LexiconConfig,
    matchingConfig?: MatchingConfig,
  ): DownloadService {
    return new DownloadService(
      new DrizzleRejectionRepository(db),
      soulseekConfig,
      downloadConfig,
      lexiconConfig,
      matchingConfig,
    );
  }

  constructor(
    rejections: IRejectionRepository,
    soulseekConfig: SoulseekConfig,
    downloadConfig: DownloadConfig,
    lexiconConfig: LexiconConfig,
    matchingConfig?: MatchingConfig,
  ) {
    this.rejections = rejections;
    this.soulseek = new SoulseekService(soulseekConfig);
    this.matcher = new FuzzyMatchStrategy({
      autoAcceptThreshold: matchingConfig?.autoAcceptThreshold ?? 0.9,
      reviewThreshold: matchingConfig?.reviewThreshold ?? 0.7,
      context: "soulseek",
      weights: matchingConfig?.soulseekWeights,
      artistRejectThreshold: 0.3,
    });
    this.allowedFormats = new Set(
      downloadConfig.formats.map((f) => f.toLowerCase()),
    );
    this.minBitrate = downloadConfig.minBitrate;
    this.concurrency = downloadConfig.concurrency;
    this.downloadRoot = lexiconConfig.downloadRoot;
    this.slskdDownloadDir = soulseekConfig.downloadDir;
    this.validationStrictness = downloadConfig.validationStrictness;
  }

  // -------------------------------------------------------------------------
  // Rejection memory
  // -------------------------------------------------------------------------

  /**
   * Get all rejected file keys for a track in the soulseek_download context.
   */
  private getRejectionsForTrack(trackId: string): Set<string> {
    return this.rejections.findFileKeysByTrackAndContext(trackId, "soulseek_download");
  }

  /**
   * Record a rejection for a Soulseek file so it won't be tried again.
   */
  async recordRejection(trackId: string, fileKey: string, reason: string): Promise<void> {
    this.rejections.insert({
      trackId,
      context: "soulseek_download",
      fileKey,
      reason,
    });
  }

  // -------------------------------------------------------------------------
  // Ranking
  // -------------------------------------------------------------------------

  /**
   * Filter by format/bitrate and rank files using fuzzy matching.
   * Filters out previously rejected files for the given track.
   */
  rankResults(
    files: SlskdFile[],
    track: TrackInfo,
    trackId: string,
  ): { ranked: RankedResult[]; diagnostics: string } {
    // 1. Rejection filter
    const rejectedKeys = this.getRejectionsForTrack(trackId);
    const rejectionFiltered = files.filter(
      (f) => !rejectedKeys.has(buildFileKey(f.username, f.filename)),
    );
    const rejectionCount = files.length - rejectionFiltered.length;

    // 2. Filter by allowed formats
    const formatFiltered = rejectionFiltered.filter((f) =>
      this.allowedFormats.has(getExtension(f.filename)),
    );

    // 3. Filter by minimum bitrate (skip check for files without bitrate info)
    const bitrateFiltered = formatFiltered.filter(
      (f) => f.bitRate == null || f.bitRate >= this.minBitrate,
    );

    // 4. Rank using fuzzy matching: build TrackInfo from each filename and compare
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

    // 5. Sort by score descending
    ranked.sort((a, b) => b.score - a.score);

    // 6. Build diagnostics
    const diag = [
      `${files.length} results`,
      rejectionCount > 0 ? `${rejectionCount} filtered by rejection memory` : null,
      rejectionFiltered.length - formatFiltered.length > 0 ? `${rejectionFiltered.length - formatFiltered.length} filtered by format` : null,
      formatFiltered.length - bitrateFiltered.length > 0 ? `${formatFiltered.length - bitrateFiltered.length} filtered by bitrate (<${this.minBitrate}kbps)` : null,
      artistRejected > 0 ? `${artistRejected} rejected by artist mismatch` : null,
      `${ranked.length} candidates`,
    ].filter(Boolean).join(", ");

    return { ranked, diagnostics: diag };
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Search Soulseek for a track using multi-strategy query builder.
   * Tries strategies in order, stopping at the first that returns results.
   */
  async searchAndRank(track: TrackInfo, trackId: string): Promise<{
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

      const result = this.rankResults(files, track, trackId);
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
    items: DownloadItem[],
  ): Promise<Map<string, { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<{ label: string; query: string; resultCount: number }> }>> {
    // Build first-strategy queries for batch
    const queryToItem = new Map<string, DownloadItem>();

    for (const item of items) {
      const strategies = generateSearchQueries(item.track);
      const query = strategies[0]?.query ?? `${item.track.artist} ${item.track.title}`;
      queryToItem.set(query, item);
    }

    const queries = [...queryToItem.keys()];
    log.debug(`Starting batch search`, { count: queries.length });

    // POST all searches with rate-limit delays
    const searchEntries = await this.soulseek.startSearchBatch(queries);
    log.debug(`All searches posted, polling for results`);

    // Poll all searches in a single loop
    const searchResults = await this.soulseek.waitForSearchBatch(searchEntries);

    // Rank results for each track
    const results = new Map<string, { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<{ label: string; query: string; resultCount: number }> }>();
    const needsFallback: DownloadItem[] = [];

    for (const [query, item] of queryToItem) {
      const files = searchResults.get(query) ?? [];
      log.debug(`Batch search results`, { query, fileCount: files.length });
      const rankResult = this.rankResults(files, item.track, item.dbTrackId);

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
      const result = await this.searchAndRank(item.track, item.dbTrackId);
      results.set(item.dbTrackId, result);
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Download batch (primary entry point)
  // -------------------------------------------------------------------------

  /**
   * Download multiple tracks: batch search all at once, then download concurrently.
   * This is the only public entry point for downloading.
   */
  async downloadBatch(
    items: DownloadItem[],
    onProgress?: (
      completed: number,
      total: number,
      result: DownloadResult,
    ) => void,
  ): Promise<DownloadResult[]> {
    const total = items.length;
    const results: DownloadResult[] = [];
    let completed = 0;

    if (total === 0) {
      return results;
    }

    // 0. Create playlist folders upfront so they're visible in Lexicon/Incoming
    const playlistNames = new Set(items.map((t) => t.playlistName));
    for (const name of playlistNames) {
      this.ensurePlaylistFolder(name);
    }

    // 1. Batch search all tracks at once
    const searchResults = await this.searchAndRankBatch(items);

    // 2. Download concurrently with sliding-window concurrency
    const pending = new Set<Promise<void>>();

    for (const item of items) {
      if (isShutdownRequested()) {
        break;
      }

      const task = this.downloadFromSearchResults(
        item,
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

  // -------------------------------------------------------------------------
  // Private: single-track download from pre-computed search results
  // -------------------------------------------------------------------------

  /**
   * Download a single track given pre-computed search results.
   * Used by downloadBatch after batch search completes.
   */
  private async downloadFromSearchResults(
    item: DownloadItem,
    searchResult?: { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<{ label: string; query: string; resultCount: number }> },
  ): Promise<DownloadResult> {
    try {
      const ranked = searchResult?.ranked ?? [];
      const diagnostics = searchResult?.diagnostics ?? "no search results";
      const strategy = searchResult?.strategy;
      const strategyLog = searchResult?.strategyLog;

      if (ranked.length === 0) {
        return {
          trackId: item.dbTrackId,
          success: false,
          error: `No matching files on Soulseek (${diagnostics})`,
          strategyLog,
        };
      }

      const best = ranked[0];

      if (best.score < 0.3) {
        return {
          trackId: item.dbTrackId,
          success: false,
          error: `Best match score too low: ${(best.score * 100).toFixed(0)}% — "${best.file.filename}" (${diagnostics})`,
          strategy,
          strategyLog,
        };
      }

      const result = await this.acquireAndMove(best.file, item.track, item.playlistName, item.dbTrackId);
      return { ...result, strategy, strategyLog };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        trackId: item.dbTrackId,
        success: false,
        error: message,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Validation (configurable strictness)
  // -------------------------------------------------------------------------

  /**
   * Validate a downloaded file's audio metadata against expected track info.
   * Behavior depends on this.validationStrictness.
   */
  async validateDownload(
    filePath: string,
    expected: TrackInfo,
    trackId: string,
    file: SlskdFile,
  ): Promise<boolean> {
    const fileKey = buildFileKey(file.username, file.filename);

    if (this.validationStrictness === "lenient") {
      try {
        await parseFile(filePath);
        return true;
      } catch {
        await this.recordRejection(trackId, fileKey, "Corrupt or unreadable audio file (lenient mode)");
        return false;
      }
    }

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

      if (this.validationStrictness === "strict") {
        const matches = this.matcher.match(expected, [tagTrack]);
        const score = matches.length > 0 ? matches[0].score : 0;

        if (score < 0.7) {
          const tagInfo = `"${tagTrack.artist} - ${tagTrack.title}"`;
          await this.recordRejection(trackId, fileKey,
            `Score ${score.toFixed(2)} below threshold 0.70 (strict) — tags: ${tagInfo}`);
          return false;
        }

        // Check duration within 5 seconds if both have duration
        if (expected.durationMs != null && tagTrack.durationMs != null) {
          const diffMs = Math.abs(expected.durationMs - tagTrack.durationMs);
          if (diffMs > 5000) {
            const diffSec = (diffMs / 1000).toFixed(1);
            await this.recordRejection(trackId, fileKey,
              `Duration mismatch: ${diffSec}s difference (expected ${(expected.durationMs / 1000).toFixed(0)}s, got ${(tagTrack.durationMs / 1000).toFixed(0)}s)`);
            return false;
          }
        }

        return true;
      }

      // Moderate mode
      if (!metadata.format.codec) {
        await this.recordRejection(trackId, fileKey, "No audio codec detected in file metadata");
        return false;
      }

      const matches = this.matcher.match(expected, [tagTrack]);
      const score = matches.length > 0 ? matches[0].score : 0;
      if (matches.length === 0 || score <= 0.5) {
        const tagInfo = `"${tagTrack.artist} - ${tagTrack.title}"`;
        await this.recordRejection(trackId, fileKey,
          `Score ${score.toFixed(2)} below threshold 0.50 (moderate) — tags: ${tagInfo}`);
        return false;
      }

      return true;
    } catch {
      await this.recordRejection(trackId, fileKey, "Corrupt or unreadable audio file");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Acquire, move, find
  // -------------------------------------------------------------------------

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

      const valid = await this.validateDownload(tempPath, track, dbTrackId, file);
      if (!valid) {
        // Look up the rejection reason we just recorded
        const fileKey = buildFileKey(file.username, file.filename);
        const reason = this.rejections.findReason(dbTrackId, "soulseek_download", fileKey)
          ?? "Unknown validation failure";
        return {
          trackId: dbTrackId,
          success: false,
          filePath: tempPath,
          error: `Validation failed: ${reason}`,
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

    // Clean up empty source directory after move
    this.cleanupEmptyDir(dirname(tempPath));

    return destPath;
  }

  /**
   * Delete a download file by its filesystem path.
   * Returns true if deleted, false if not found.
   */
  deleteDownloadFile(filePath: string): boolean {
    if (!existsSync(filePath)) return false;
    try {
      unlinkSync(filePath);
      // Also clean up the parent directory if now empty
      this.cleanupEmptyDir(dirname(filePath));
      return true;
    } catch (err) {
      log.warn(`Failed to delete file`, { filePath, error: String(err) });
      return false;
    }
  }

  /**
   * Scan the slskd download directory and remove all empty subdirectories.
   * Returns the number of directories removed.
   */
  cleanupEmptyDirs(): number {
    if (!existsSync(this.slskdDownloadDir)) return 0;

    let removed = 0;
    try {
      const entries = readdirSync(this.slskdDownloadDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subdir = join(this.slskdDownloadDir, entry.name);
        if (this.isDirEmpty(subdir)) {
          try {
            rmdirSync(subdir);
            removed++;
            log.debug(`Removed empty directory`, { dir: subdir });
          } catch {
            // ignore — might be in use
          }
        }
      }
    } catch {
      // ignore read errors
    }

    return removed;
  }

  /** Get the slskd download directory path. */
  getSlskdDownloadDir(): string {
    return this.slskdDownloadDir;
  }

  /**
   * Check if a file's size is stable (not still being written to).
   * Reads size, waits, reads again, returns true if unchanged.
   */
  async checkFileStable(filePath: string, waitMs = 5000): Promise<boolean> {
    try {
      const size1 = statSync(filePath).size;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (!existsSync(filePath)) return false;
      const size2 = statSync(filePath).size;
      return size1 === size2 && size1 > 0;
    } catch {
      return false;
    }
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
  findDownloadedFile(_username: string, filename: string): string | null {
    // Extract just the filename (last segment) from the remote path
    const withoutShare = filename.replace(/^@@[^\\\/]+[\\\/]/, "");
    const normalized = withoutShare.replaceAll("\\", "/");
    const targetFilename = normalized.split("/").filter(Boolean).pop();
    if (!targetFilename) return null;

    const ext = extname(targetFilename);
    const base = basename(targetFilename, ext).toLowerCase();

    // Strategy 1: Try last-2-segments path (common slskd layout)
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length >= 2) {
      const expectedPath = join(this.slskdDownloadDir, segments.slice(-2).join("/"));
      if (existsSync(expectedPath)) return expectedPath;

      // Check for suffixed variants in that directory
      const dir = dirname(expectedPath);
      if (existsSync(dir)) {
        const match = this.findBestMatch(dir, base, ext);
        if (match) return match;
      }
    }

    // Strategy 2: Recursive search by filename across all download subdirectories
    if (!existsSync(this.slskdDownloadDir)) return null;

    try {
      const dirs = readdirSync(this.slskdDownloadDir, { withFileTypes: true });
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        const subdir = join(this.slskdDownloadDir, entry.name);
        const match = this.findBestMatch(subdir, base, ext);
        if (match) return match;
      }
    } catch {
      // ignore read errors
    }

    return null;
  }

  /**
   * Remove a directory if it is empty. Does not recurse into parent dirs
   * to avoid accidentally removing the slskd root.
   */
  private cleanupEmptyDir(dir: string): void {
    // Safety: never remove the download root itself
    if (dir === this.slskdDownloadDir || dir === this.downloadRoot) return;
    if (!existsSync(dir)) return;

    if (this.isDirEmpty(dir)) {
      try {
        rmdirSync(dir);
        log.debug(`Removed empty directory after move`, { dir });
      } catch {
        // ignore — directory might be in use
      }
    }
  }

  /** Check if a directory is empty (no files or subdirs). */
  private isDirEmpty(dir: string): boolean {
    try {
      const entries = readdirSync(dir);
      return entries.length === 0;
    } catch {
      return false;
    }
  }

  /** Find best matching file in a directory by base name and extension. */
  private findBestMatch(dir: string, baseLower: string, ext: string): string | null {
    try {
      const candidates = readdirSync(dir)
        .filter((f) => {
          const fBase = basename(f, extname(f)).toLowerCase();
          const fExt = extname(f);
          // Match by base name (exact or with slskd suffix like _639094...)
          return fExt === ext && (fBase === baseLower || fBase.startsWith(baseLower + "_"));
        })
        .map((f) => join(dir, f))
        .sort((a, b) => {
          try {
            return statSync(b).mtimeMs - statSync(a).mtimeMs;
          } catch {
            return 0;
          }
        });
      return candidates[0] ?? null;
    } catch {
      return null;
    }
  }
}
