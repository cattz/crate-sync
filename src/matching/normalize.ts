/**
 * Normalization utilities for track matching.
 * Ported from sldl-python's matcher_service.py with JS Unicode support.
 */

export const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "in",
  "on",
  "at",
  "to",
  "for",
  "is",
  "it",
]);

const REMIX_KEYWORDS = new Set([
  "remix",
  "edit",
  "mix",
  "version",
  "dub",
  "rework",
  "remaster",
  "remastered",
  "bootleg",
  "instrumental",
  "acoustic",
  "live",
  "radio",
  "extended",
  "vip",
]);

/** Strip diacritics: decompose to NFKD, remove combining marks, recompose. */
export function normalizeUnicode(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
}

/** Lowercase, strip diacritics, remove non-word chars, collapse whitespace. */
export function normalizeBase(s: string): string {
  return normalizeUnicode(s)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Like normalizeBase but also strips leading "the " and normalizes "&" to "and". */
export function normalizeArtist(s: string): string {
  let result = s.replace(/\s*&\s*/g, " and ");
  result = normalizeBase(result);
  result = result.replace(/^the\s+/, "");
  return result;
}

/** Remove stopwords from a word set (for Jaccard similarity only). */
export function removeStopwords(words: Set<string>): Set<string> {
  const filtered = new Set<string>();
  for (const w of words) {
    if (!STOPWORDS.has(w)) filtered.add(w);
  }
  return filtered.size > 0 ? filtered : words; // keep original if all words are stopwords
}

/**
 * Strip remix/edit/version suffixes from a title.
 * Handles both "Title - Remix Info" and "Title (Remix Info)" patterns.
 */
export function stripRemixSuffix(title: string): string {
  // Try " - suffix" pattern
  const dashIdx = title.lastIndexOf(" - ");
  if (dashIdx > 0) {
    const suffix = title.slice(dashIdx + 3).toLowerCase();
    if (hasRemixKeyword(suffix)) {
      return title.slice(0, dashIdx).trim();
    }
  }

  // Try "(suffix)" pattern — remove last parenthesized group if it contains remix keywords
  const parenMatch = title.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const suffix = parenMatch[2].toLowerCase();
    if (hasRemixKeyword(suffix)) {
      return parenMatch[1].trim();
    }
  }

  return title;
}

function hasRemixKeyword(s: string): boolean {
  const words = s.split(/\s+/);
  return words.some((w) => REMIX_KEYWORDS.has(w.replace(/[^\w]/g, "")));
}

// Camelot key notation: 1A-12B, or standard keys like Am, Cm, etc.
const KEY_BPM_PATTERN = /\b(?:[0-9]{1,2}[ABab]\s+\d{2,3}|\d{2,3}\s+[0-9]{1,2}[ABab]|[A-G][b#]?m?\s+\d{2,3})\s*$/;

// DJ suffix keywords that appear in parentheses/brackets
const DJ_SUFFIX_KEYWORDS = new Set([
  "clean", "dirty", "intro", "outro", "short", "long",
  "quick", "transition", "qh", "tmu",
  ...REMIX_KEYWORDS,
]);

/**
 * Normalize a title for matching: strip all parenthetical/bracket content,
 * trailing key/BPM patterns, and "feat."/"ft." credits.
 */
export function normalizeTitle(title: string): string {
  let result = title;

  // Strip all parenthetical and bracket groups
  result = result.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, " ");

  // Strip trailing key/BPM patterns (e.g. "4A 107", "Am 128")
  result = result.replace(KEY_BPM_PATTERN, "");

  // Strip feat./ft. credits
  result = result.replace(/\s*(feat\.?|ft\.?)\s+.*/i, "");

  // Collapse whitespace and trim
  result = result.replace(/\s+/g, " ").trim();

  return result || title; // fallback to original if everything was stripped
}
