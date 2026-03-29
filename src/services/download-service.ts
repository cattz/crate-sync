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
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";

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
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

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
  private readonly db: Database;
  private readonly soulseek: SoulseekService;
  private readonly matcher: FuzzyMatchStrategy;
  private readonly allowedFormats: Set<string>;
  private readonly minBitrate: number;
  private readonly concurrency: number;
  private readonly downloadRoot: string;
  private readonly slskdDownloadDir: string;
  private readonly validationStrictness: ValidationStrictness;

  constructor(
    db: Database,
    soulseekConfig: SoulseekConfig,
    downloadConfig: DownloadConfig,
    lexiconConfig: LexiconConfig,
  ) {
    this.db = db;
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
    this.validationStrictness = downloadConfig.validationStrictness;
  }

  // -------------------------------------------------------------------------
  // Rejection memory
  // -------------------------------------------------------------------------

  /**
   * Get all rejected file keys for a track in the soulseek_download context.
   */
  private getRejectionsForTrack(trackId: string): Set<string> {
    const rows = this.db
      .select({ fileKey: schema.rejections.fileKey })
      .from(schema.rejections)
      .where(
        and(
          eq(schema.rejections.trackId, trackId),
          eq(schema.rejections.context, "soulseek_download"),
        ),
      )
      .all();

    return new Set(rows.map((r) => r.fileKey));
  }

  /**
   * Record a rejection for a Soulseek file so it won't be tried again.
   * Uses INSERT OR IGNORE to handle the unique constraint gracefully.
   */
  async recordRejection(trackId: string, fileKey: string, reason: string): Promise<void> {
    this.db
      .insert(schema.rejections)
      .values({
        id: crypto.randomUUID(),
        trackId,
        context: "soulseek_download",
        fileKey,
        reason,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
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
        await this.recordRejection(trackId, fileKey, "validation_failed");
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
          await this.recordRejection(trackId, fileKey, "validation_failed");
          return false;
        }

        // Check duration within 5 seconds if both have duration
        if (expected.durationMs != null && tagTrack.durationMs != null) {
          if (Math.abs(expected.durationMs - tagTrack.durationMs) > 5000) {
            await this.recordRejection(trackId, fileKey, "validation_failed");
            return false;
          }
        }

        return true;
      }

      // Moderate mode
      if (!metadata.format.codec) {
        await this.recordRejection(trackId, fileKey, "validation_failed");
        return false;
      }

      const matches = this.matcher.match(expected, [tagTrack]);
      if (matches.length === 0 || matches[0].score <= 0.5) {
        await this.recordRejection(trackId, fileKey, "validation_failed");
        return false;
      }

      return true;
    } catch {
      await this.recordRejection(trackId, fileKey, "validation_failed");
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
