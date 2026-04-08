import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { TrackInfo } from "../types/common.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportFormat = "m3u" | "csv" | "txt";

export interface ParsedPlaylist {
  name: string;
  tracks: TrackInfo[];
  format: ImportFormat;
  sourcePath: string;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

const FORMAT_MAP: Record<string, ImportFormat> = {
  ".m3u": "m3u",
  ".m3u8": "m3u",
  ".csv": "csv",
  ".txt": "txt",
};

export function detectFormat(filePath: string): ImportFormat | null {
  return FORMAT_MAP[extname(filePath).toLowerCase()] ?? null;
}

export function isSupportedFile(filePath: string): boolean {
  return detectFormat(filePath) !== null;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse M3U/M3U8: extract artist/title from #EXTINF lines.
 * Format: #EXTINF:<duration>,<artist> - <title>
 */
export function parseM3U(content: string): TrackInfo[] {
  const tracks: TrackInfo[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF:")) continue;

    // #EXTINF:240,Artist - Title
    const afterTag = line.slice("#EXTINF:".length);
    const commaIdx = afterTag.indexOf(",");
    if (commaIdx === -1) continue;

    const durationStr = afterTag.slice(0, commaIdx).trim();
    const display = afterTag.slice(commaIdx + 1).trim();
    if (!display) continue;

    const durationSec = parseInt(durationStr, 10);
    const parsed = parseArtistTitle(display);
    if (!parsed) continue;

    tracks.push({
      ...parsed,
      durationMs: !isNaN(durationSec) && durationSec > 0 ? durationSec * 1000 : undefined,
    });
  }

  return tracks;
}

/**
 * Parse CSV: expects header row with artist, title columns.
 * Also supports: album, duration (seconds), isrc.
 */
export function parseCSV(content: string): TrackInfo[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return []; // need header + at least 1 row

  const header = parseCSVRow(lines[0]).map((h) => h.toLowerCase().trim());
  const artistCol = header.findIndex((h) => h === "artist");
  const titleCol = header.findIndex((h) => h === "title");

  if (artistCol === -1 || titleCol === -1) return [];

  const albumCol = header.findIndex((h) => h === "album");
  const durationCol = header.findIndex((h) => h === "duration" || h === "duration_s" || h === "duration_ms");
  const isDurationMs = durationCol !== -1 && header[durationCol].includes("ms");
  const isrcCol = header.findIndex((h) => h === "isrc");

  const tracks: TrackInfo[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const artist = cols[artistCol]?.trim();
    const title = cols[titleCol]?.trim();
    if (!artist || !title) continue;

    const track: TrackInfo = { artist, title };

    if (albumCol !== -1 && cols[albumCol]?.trim()) {
      track.album = cols[albumCol].trim();
    }
    if (durationCol !== -1 && cols[durationCol]?.trim()) {
      const dur = parseInt(cols[durationCol].trim(), 10);
      if (!isNaN(dur) && dur > 0) {
        track.durationMs = isDurationMs ? dur : dur * 1000;
      }
    }
    if (isrcCol !== -1 && cols[isrcCol]?.trim()) {
      track.isrc = cols[isrcCol].trim();
    }

    tracks.push(track);
  }

  return tracks;
}

/**
 * Parse TXT: one track per line, "Artist - Title" format.
 * Lines starting with # are comments.
 */
export function parseTXT(content: string): TrackInfo[] {
  const tracks: TrackInfo[] = [];

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parsed = parseArtistTitle(line);
    if (parsed) tracks.push(parsed);
  }

  return tracks;
}

// ---------------------------------------------------------------------------
// Unified parse
// ---------------------------------------------------------------------------

export function parsePlaylistFile(filePath: string): ParsedPlaylist {
  const format = detectFormat(filePath);
  if (!format) {
    throw new Error(`Unsupported file format: ${extname(filePath)}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const name = basename(filePath, extname(filePath));

  let tracks: TrackInfo[];
  switch (format) {
    case "m3u":
      tracks = parseM3U(content);
      break;
    case "csv":
      tracks = parseCSV(content);
      break;
    case "txt":
      tracks = parseTXT(content);
      break;
  }

  return { name, tracks, format, sourcePath: filePath };
}

/**
 * Parse all supported files in a directory (non-recursive).
 */
export function parsePlaylistDir(dirPath: string): ParsedPlaylist[] {
  const entries = readdirSync(dirPath);
  const results: ParsedPlaylist[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    if (!statSync(fullPath).isFile()) continue;
    if (!isSupportedFile(fullPath)) continue;

    try {
      results.push(parsePlaylistFile(fullPath));
    } catch {
      // Skip unparseable files
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "Artist - Title" into { artist, title }. */
function parseArtistTitle(s: string): TrackInfo | null {
  // Try " - " separator first (most common)
  const dashIdx = s.indexOf(" - ");
  if (dashIdx > 0) {
    const artist = s.slice(0, dashIdx).trim();
    const title = s.slice(dashIdx + 3).trim();
    if (artist && title) return { artist, title };
  }

  // Try " — " (em dash)
  const emDashIdx = s.indexOf(" — ");
  if (emDashIdx > 0) {
    const artist = s.slice(0, emDashIdx).trim();
    const title = s.slice(emDashIdx + 3).trim();
    if (artist && title) return { artist, title };
  }

  return null;
}

/** Parse a single CSV row, handling quoted fields. */
function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
