import { extname, join } from "node:path";
import { existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from "node:fs";
import { parseFile } from "music-metadata";
import type { TrackInfo } from "../types/common.js";
import type { TrackSource, SourceCandidate } from "../sources/types.js";
import type { MatchingConfig, DownloadConfig, LexiconConfig } from "../config.js";
import type { IRejectionRepository } from "../ports/repositories.js";
import { FuzzyMatchStrategy } from "../matching/fuzzy.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("acquisition");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankedCandidate {
  candidate: SourceCandidate;
  score: number;
}

export interface SearchResult {
  candidates: RankedCandidate[];
  sourceId: string;
  diagnostics: string;
}

export interface PlacedFile {
  finalPath: string;
  sourceId: string;
  sourceKey: string;
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

/** Get the file extension (lowercase, without dot). */
function getExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

// ---------------------------------------------------------------------------
// AcquisitionService
// ---------------------------------------------------------------------------

/**
 * Source-agnostic orchestrator that searches multiple TrackSources in
 * priority order and ranks candidates using the existing FuzzyMatchStrategy.
 *
 * This replaces the search+rank logic previously inlined in DownloadService
 * for the search handler path. DownloadService retains its Soulseek-specific
 * batch search/download methods.
 */
export class AcquisitionService {
  private readonly sources: TrackSource[];
  private readonly rejections: IRejectionRepository;
  private readonly matcher: FuzzyMatchStrategy;
  private readonly allowedFormats: Set<string>;
  private readonly minBitrate: number;
  private readonly downloadRoot: string;
  private readonly validationStrictness: DownloadConfig["validationStrictness"];

  constructor(
    sources: TrackSource[],
    rejections: IRejectionRepository,
    matchingConfig: MatchingConfig,
    downloadConfig: DownloadConfig,
    lexiconConfig: LexiconConfig,
  ) {
    this.sources = sources;
    this.rejections = rejections;
    this.matcher = new FuzzyMatchStrategy({
      autoAcceptThreshold: matchingConfig.autoAcceptThreshold,
      reviewThreshold: matchingConfig.reviewThreshold,
      context: "soulseek", // reuse soulseek weights for ranking
      weights: matchingConfig.soulseekWeights,
      artistRejectThreshold: 0.3,
    });
    this.allowedFormats = new Set(
      downloadConfig.formats.map((f) => f.toLowerCase()),
    );
    this.minBitrate = downloadConfig.minBitrate;
    this.downloadRoot = lexiconConfig.downloadRoot;
    this.validationStrictness = downloadConfig.validationStrictness;
  }

  // -------------------------------------------------------------------------
  // Search all sources
  // -------------------------------------------------------------------------

  /**
   * Search all sources in priority order for candidates matching a track.
   * Returns ranked results from the first source that has matches.
   */
  async searchAllSources(
    track: TrackInfo,
    trackId: string,
  ): Promise<SearchResult | null> {
    for (const source of this.sources) {
      if (!(await source.isAvailable())) {
        log.debug(`Source not available, skipping`, { sourceId: source.id });
        continue;
      }

      log.debug(`Searching source`, { sourceId: source.id, title: track.title, artist: track.artist });
      const candidates = await source.search(track, trackId);
      if (candidates.length === 0) {
        log.debug(`Source returned 0 candidates`, { sourceId: source.id });
        continue;
      }

      // Filter out rejected candidates
      const rejectedKeys = this.rejections.findFileKeysByTrackAndContext(trackId, "source_acquisition");
      const filtered = candidates.filter((c) => !rejectedKeys.has(c.sourceKey));
      const rejectionCount = candidates.length - filtered.length;

      if (filtered.length === 0) {
        log.debug(`All candidates from source rejected`, {
          sourceId: source.id,
          total: candidates.length,
          rejected: rejectionCount,
        });
        continue;
      }

      // Filter by allowed format
      const formatFiltered = filtered.filter((c) => {
        if (!c.quality?.format) return true; // no format info, keep it
        return this.allowedFormats.has(c.quality.format.toLowerCase());
      });

      // Filter by minimum bitrate
      const bitrateFiltered = formatFiltered.filter((c) => {
        if (c.quality?.bitRate == null) return true; // no bitrate info, keep it
        return c.quality.bitRate >= this.minBitrate;
      });

      if (bitrateFiltered.length === 0) {
        log.debug(`All candidates from source filtered out`, {
          sourceId: source.id,
          afterRejection: filtered.length,
          afterFormat: formatFiltered.length,
          afterBitrate: bitrateFiltered.length,
        });
        continue;
      }

      // Rank using fuzzy matching
      const ranked = this.rankCandidates(track, bitrateFiltered);

      if (ranked.length === 0) {
        log.debug(`No candidates above match threshold`, { sourceId: source.id });
        continue;
      }

      const diagnostics = [
        `source: ${source.id}`,
        `${candidates.length} raw candidates`,
        rejectionCount > 0 ? `${rejectionCount} rejected` : null,
        candidates.length - formatFiltered.length > 0
          ? `${candidates.length - formatFiltered.length} format-filtered`
          : null,
        formatFiltered.length - bitrateFiltered.length > 0
          ? `${formatFiltered.length - bitrateFiltered.length} bitrate-filtered`
          : null,
        `${ranked.length} ranked`,
        `best: ${(ranked[0].score * 100).toFixed(0)}%`,
      ]
        .filter(Boolean)
        .join(", ");

      log.info(`Source matched`, {
        sourceId: source.id,
        candidates: ranked.length,
        bestScore: ranked[0].score,
      });

      return { candidates: ranked, sourceId: source.id, diagnostics };
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Validate and place a local file
  // -------------------------------------------------------------------------

  /**
   * Validate a local candidate file and place it in the Lexicon/Incoming folder.
   * Used when a local source finds a match (skips the download job entirely).
   */
  async validateAndPlace(
    candidate: SourceCandidate,
    track: TrackInfo,
    trackId: string,
    playlistName: string,
  ): Promise<PlacedFile | null> {
    const srcPath = candidate.localPath;
    if (!srcPath || !existsSync(srcPath)) {
      log.warn(`Candidate file not found`, { sourceKey: candidate.sourceKey, localPath: srcPath });
      return null;
    }

    // Validate audio metadata
    const valid = await this.validateFile(srcPath, track, trackId, candidate.sourceKey);
    if (!valid) {
      return null;
    }

    // Place in playlist folder
    const finalPath = this.placeInPlaylistFolder(srcPath, playlistName, track, candidate);
    if (!finalPath) {
      return null;
    }

    return {
      finalPath,
      sourceId: candidate.sourceId,
      sourceKey: candidate.sourceKey,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Rank candidates using FuzzyMatchStrategy.
   */
  private rankCandidates(
    track: TrackInfo,
    candidates: SourceCandidate[],
  ): RankedCandidate[] {
    if (candidates.length === 0) return [];

    const candidateTrackInfos = candidates.map((c) => c.trackInfo);
    const results = this.matcher.match(track, candidateTrackInfos);

    const ranked: RankedCandidate[] = [];
    for (const result of results) {
      const idx = candidateTrackInfos.indexOf(result.candidate);
      if (idx >= 0) {
        ranked.push({ candidate: candidates[idx], score: result.score });
      }
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  /**
   * Validate a file's audio metadata against expected track info.
   */
  private async validateFile(
    filePath: string,
    expected: TrackInfo,
    trackId: string,
    sourceKey: string,
  ): Promise<boolean> {
    if (this.validationStrictness === "lenient") {
      try {
        await parseFile(filePath);
        return true;
      } catch {
        this.recordRejection(trackId, sourceKey, "Corrupt or unreadable audio file (lenient mode)");
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
          this.recordRejection(trackId, sourceKey,
            `Score ${score.toFixed(2)} below threshold 0.70 (strict) — tags: ${tagInfo}`);
          return false;
        }

        if (expected.durationMs != null && tagTrack.durationMs != null) {
          const diffMs = Math.abs(expected.durationMs - tagTrack.durationMs);
          if (diffMs > 5000) {
            const diffSec = (diffMs / 1000).toFixed(1);
            this.recordRejection(trackId, sourceKey,
              `Duration mismatch: ${diffSec}s difference (expected ${(expected.durationMs / 1000).toFixed(0)}s, got ${(tagTrack.durationMs / 1000).toFixed(0)}s)`);
            return false;
          }
        }

        return true;
      }

      // Moderate mode
      if (!metadata.format.codec) {
        this.recordRejection(trackId, sourceKey, "No audio codec detected in file metadata");
        return false;
      }

      const matches = this.matcher.match(expected, [tagTrack]);
      const score = matches.length > 0 ? matches[0].score : 0;
      if (matches.length === 0 || score <= 0.5) {
        const tagInfo = `"${tagTrack.artist} - ${tagTrack.title}"`;
        this.recordRejection(trackId, sourceKey,
          `Score ${score.toFixed(2)} below threshold 0.50 (moderate) — tags: ${tagInfo}`);
        return false;
      }

      return true;
    } catch {
      this.recordRejection(trackId, sourceKey, "Corrupt or unreadable audio file");
      return false;
    }
  }

  /**
   * Copy or move a local file to the playlist folder.
   * Uses the source's fileOp setting via the candidate metadata.
   */
  private placeInPlaylistFolder(
    srcPath: string,
    playlistName: string,
    track: TrackInfo,
    candidate: SourceCandidate,
  ): string | null {
    const ext = getExtension(srcPath);
    const safeName = `${sanitize(track.artist)} - ${sanitize(track.title)}`;
    const destDir = join(this.downloadRoot, sanitize(playlistName));
    const destPath = join(destDir, `${safeName}.${ext}`);

    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    const fileOp = (candidate.meta.fileOp as string) ?? "copy";

    try {
      if (fileOp === "move") {
        try {
          renameSync(srcPath, destPath);
        } catch {
          // Cross-device: fallback to copy + delete
          copyFileSync(srcPath, destPath);
          unlinkSync(srcPath);
        }
      } else {
        copyFileSync(srcPath, destPath);
      }

      log.info(`Placed file`, { sourceId: candidate.sourceId, fileOp, destPath });
      return destPath;
    } catch (err) {
      log.error(`Failed to place file`, {
        srcPath,
        destPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Record a rejection so the candidate won't be tried again.
   */
  private recordRejection(trackId: string, sourceKey: string, reason: string): void {
    this.rejections.insert({
      trackId,
      context: "source_acquisition",
      fileKey: sourceKey,
      reason,
    });
  }
}
