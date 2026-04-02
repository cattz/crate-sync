import {
  existsSync,
  readdirSync,
  copyFileSync,
  renameSync,
  mkdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, extname, basename, parse as parsePath } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { TrackInfo } from "../types/common.js";
import type { LocalSourceConfig } from "../config.js";
import type { TrackSource, SourceCandidate, AcquiredFile } from "./types.js";
import { normalizeBase, normalizeArtist } from "../matching/normalize.js";
import { FuzzyMatchStrategy } from "../matching/fuzzy.js";
import type { FuzzyMatchConfig } from "../matching/types.js";

const MATCH_CONFIG: FuzzyMatchConfig = {
  autoAcceptThreshold: 0.85,
  reviewThreshold: 0.6,
  context: "lexicon",
};

const matcher = new FuzzyMatchStrategy(MATCH_CONFIG);

/** Word-set Jaccard similarity on normalized strings. */
function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(" ").filter(Boolean));
  const wordsB = new Set(b.split(" ").filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Check if normalized folder name is a fuzzy match for the target artist. */
function isArtistMatch(folderNorm: string, artistNorm: string): boolean {
  if (folderNorm === artistNorm) return true;
  if (folderNorm.includes(artistNorm) || artistNorm.includes(folderNorm)) {
    return true;
  }
  return wordSimilarity(folderNorm, artistNorm) >= 0.5;
}

/** Safely readdir, returning empty array if the path doesn't exist or isn't a directory. */
function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Check if a path is a directory. */
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Parse title from a filename like "NN - Title.ext" or "NN Title.ext". */
function parseTitleFromFilename(filename: string): string {
  const name = parsePath(filename).name;
  // Pattern: "01 - Title" or "1 - Title"
  const dashMatch = name.match(/^\d+\s*-\s*(.+)$/);
  if (dashMatch) return dashMatch[1].trim();
  // Pattern: "01 Title" or "1 Title"
  const spaceMatch = name.match(/^\d+\s+(.+)$/);
  if (spaceMatch) return spaceMatch[1].trim();
  return name;
}

/** Parse "Artist - Title.ext" filenames (DJ folder structure). */
function parseArtistTitle(filename: string): { artist: string; title: string } | null {
  const name = parsePath(filename).name;
  const dashIdx = name.indexOf(" - ");
  if (dashIdx < 0) return null;
  return {
    artist: name.slice(0, dashIdx).trim(),
    title: name.slice(dashIdx + 3).trim(),
  };
}

export class LocalFilesystemSource implements TrackSource {
  readonly id: string;
  readonly name: string;
  private readonly config: LocalSourceConfig;

  constructor(config: LocalSourceConfig & { name: string }) {
    this.config = config;
    this.name = config.name;
    this.id = `local:${config.name}`;
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.config.path);
  }

  async search(track: TrackInfo, _trackId: string): Promise<SourceCandidate[]> {
    switch (this.config.structure) {
      case "letter-artist-album":
        return this.searchLetterArtistAlbum(track);
      case "artist-album":
        return this.searchArtistAlbum(track);
      case "flat":
        return this.searchFlat(track);
      case "year-playlist":
        return this.searchYearPlaylist(track);
      default:
        return [];
    }
  }

  async acquire(candidate: SourceCandidate): Promise<AcquiredFile | null> {
    const srcPath = candidate.localPath;
    if (!srcPath || !existsSync(srcPath)) return null;

    const ext = extname(srcPath);
    const tmpDir = join(tmpdir(), "crate-sync-acquire");
    mkdirSync(tmpDir, { recursive: true });
    const destPath = join(tmpDir, `${randomUUID()}${ext}`);

    try {
      if (this.config.fileOp === "move") {
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
      return { localPath: destPath, candidate };
    } catch {
      return null;
    }
  }

  // --- Structure-specific search methods ---

  private searchLetterArtistAlbum(track: TrackInfo): SourceCandidate[] {
    const artistNorm = normalizeArtist(track.artist);
    if (!artistNorm) return [];

    const firstLetter = artistNorm[0].toUpperCase();
    const letterDir = join(this.config.path, firstLetter);
    if (!isDirectory(letterDir)) return [];

    const artistFolders = safeReaddir(letterDir).filter((f) =>
      isDirectory(join(letterDir, f)) && isArtistMatch(normalizeArtist(f), artistNorm),
    );

    const candidates: SourceCandidate[] = [];
    for (const artistFolder of artistFolders) {
      const artistPath = join(letterDir, artistFolder);
      candidates.push(...this.scanAlbumsForTrack(track, artistPath, artistFolder));
    }
    return this.rankCandidates(track, candidates);
  }

  private searchArtistAlbum(track: TrackInfo): SourceCandidate[] {
    const artistNorm = normalizeArtist(track.artist);
    if (!artistNorm) return [];

    const rootEntries = safeReaddir(this.config.path);
    const artistFolders = rootEntries.filter((f) =>
      isDirectory(join(this.config.path, f)) && isArtistMatch(normalizeArtist(f), artistNorm),
    );

    const candidates: SourceCandidate[] = [];
    for (const artistFolder of artistFolders) {
      const artistPath = join(this.config.path, artistFolder);
      candidates.push(...this.scanAlbumsForTrack(track, artistPath, artistFolder));
    }
    return this.rankCandidates(track, candidates);
  }

  private searchFlat(track: TrackInfo): SourceCandidate[] {
    const files = safeReaddir(this.config.path).filter((f) =>
      this.isAllowedFormat(f) && !isDirectory(join(this.config.path, f)),
    );

    const candidates: SourceCandidate[] = [];
    for (const file of files) {
      const parsed = parseArtistTitle(file);
      const trackInfo: TrackInfo = parsed
        ? { artist: parsed.artist, title: parsed.title }
        : { artist: "", title: parseTitleFromFilename(file) };

      candidates.push(this.makeCandidate(
        join(this.config.path, file),
        trackInfo,
        file,
      ));
    }
    return this.rankCandidates(track, candidates);
  }

  private searchYearPlaylist(track: TrackInfo): SourceCandidate[] {
    const candidates: SourceCandidate[] = [];
    const yearDirs = safeReaddir(this.config.path).filter((d) =>
      isDirectory(join(this.config.path, d)),
    );

    for (const yearDir of yearDirs) {
      const yearPath = join(this.config.path, yearDir);
      const playlistDirs = safeReaddir(yearPath).filter((d) =>
        isDirectory(join(yearPath, d)),
      );

      for (const playlistDir of playlistDirs) {
        const playlistPath = join(yearPath, playlistDir);
        const files = safeReaddir(playlistPath).filter((f) =>
          this.isAllowedFormat(f) && !isDirectory(join(playlistPath, f)),
        );

        for (const file of files) {
          const parsed = parseArtistTitle(file);
          if (!parsed) continue;
          candidates.push(this.makeCandidate(
            join(playlistPath, file),
            { artist: parsed.artist, title: parsed.title },
            file,
          ));
        }
      }
    }
    return this.rankCandidates(track, candidates);
  }

  // --- Helpers ---

  /** Scan album subdirectories for files matching the track. */
  private scanAlbumsForTrack(
    track: TrackInfo,
    artistPath: string,
    artistFolder: string,
  ): SourceCandidate[] {
    const candidates: SourceCandidate[] = [];
    const albumDirs = safeReaddir(artistPath);

    for (const albumEntry of albumDirs) {
      const albumPath = join(artistPath, albumEntry);

      if (isDirectory(albumPath)) {
        // Album subfolder: scan files inside
        const files = safeReaddir(albumPath).filter((f) =>
          this.isAllowedFormat(f) && !isDirectory(join(albumPath, f)),
        );

        for (const file of files) {
          const title = parseTitleFromFilename(file);
          candidates.push(this.makeCandidate(
            join(albumPath, file),
            { artist: artistFolder, title, album: albumEntry },
            file,
          ));
        }
      } else if (this.isAllowedFormat(albumEntry)) {
        // Loose file directly in artist folder
        const title = parseTitleFromFilename(albumEntry);
        candidates.push(this.makeCandidate(
          join(artistPath, albumEntry),
          { artist: artistFolder, title },
          albumEntry,
        ));
      }
    }
    return candidates;
  }

  private makeCandidate(
    filePath: string,
    trackInfo: TrackInfo,
    filename: string,
  ): SourceCandidate {
    const ext = extname(filename).slice(1).toLowerCase();
    return {
      sourceKey: `${this.id}:${filePath}`,
      sourceId: this.id,
      trackInfo,
      localPath: filePath,
      meta: { filename, structure: this.config.structure, fileOp: this.config.fileOp },
      quality: { format: ext },
    };
  }

  /** Use the fuzzy matching engine to rank candidates and return top matches. */
  private rankCandidates(
    track: TrackInfo,
    candidates: SourceCandidate[],
  ): SourceCandidate[] {
    if (candidates.length === 0) return [];

    const candidateTrackInfos = candidates.map((c) => c.trackInfo);
    const results = matcher.match(track, candidateTrackInfos);

    // Map back to SourceCandidates, keeping only those above review threshold
    const ranked: SourceCandidate[] = [];
    for (const result of results) {
      if (result.score < MATCH_CONFIG.reviewThreshold) break;
      const idx = candidateTrackInfos.indexOf(result.candidate);
      if (idx >= 0) {
        ranked.push(candidates[idx]);
      }
    }
    return ranked;
  }

  private isAllowedFormat(filename: string): boolean {
    const ext = extname(filename).slice(1).toLowerCase();
    return this.config.formats.includes(ext);
  }
}
