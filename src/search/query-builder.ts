import type { TrackInfo } from "../types/common.js";
import { stripRemixSuffix } from "../matching/normalize.js";

/**
 * Clean a string for search queries:
 * - Replace " - " with space
 * - Remove parenthetical content: (Remix), (feat. X), (Extended Mix)
 * - Collapse multiple spaces
 */
function cleanForSearch(s: string): string {
  return s
    .replace(/\s+-\s+/g, " ")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the first N significant words from a string.
 * Filters out short words (<=2 chars) unless that's all we have.
 */
function significantWords(s: string, count: number): string[] {
  const words = cleanForSearch(s).split(/\s+/).filter(Boolean);
  const significant = words.filter((w) => w.length > 2);
  return (significant.length >= count ? significant : words).slice(0, count);
}

export interface QueryStrategy {
  /** Human-readable label for logging */
  label: string;
  /** The search query string */
  query: string;
}

/**
 * Generate multiple search query strategies for a track, ordered from most
 * specific to most lenient. The caller should try each in order and stop at
 * the first that returns results.
 */
export function generateSearchQueries(track: TrackInfo): QueryStrategy[] {
  const artist = cleanForSearch(track.artist);
  const title = cleanForSearch(track.title);
  const strategies: QueryStrategy[] = [];

  // Strategy 1: full cleaned artist + title
  if (artist && title) {
    strategies.push({ label: "full", query: `${artist} ${title}` });
  }

  // Strategy 2: artist + base title (strip remix/edit suffix)
  const baseTitle = cleanForSearch(stripRemixSuffix(track.title));
  if (artist && baseTitle && baseTitle !== title) {
    strategies.push({ label: "base-title", query: `${artist} ${baseTitle}` });
  }

  // Strategy 3: title only (handles different artist spellings)
  if (title) {
    strategies.push({ label: "title-only", query: title });
  }

  // Strategy 4: artist + first 2 significant words from title (handles long titles)
  if (artist && title) {
    const keywords = significantWords(track.title, 2);
    if (keywords.length >= 2) {
      const keywordQuery = `${artist} ${keywords.join(" ")}`;
      // Only add if different from strategies already generated
      if (!strategies.some((s) => s.query === keywordQuery)) {
        strategies.push({ label: "keywords", query: keywordQuery });
      }
    }
  }

  return strategies;
}
