import type { TrackInfo, MatchResult } from "../types/common.js";
import type { MatchStrategy, MatchOptions } from "./types.js";

const TITLE_WEIGHT = 0.5;
const ARTIST_WEIGHT = 0.4;
const DURATION_WEIGHT = 0.1;
const MIN_THRESHOLD = 0.3;
const DURATION_TOLERANCE_MS = 5000;

/** Normalize a string for comparison: lowercase, strip punctuation, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a normalized string into a set of unique words. */
function wordSet(s: string): Set<string> {
  if (s.length === 0) return new Set();
  return new Set(s.split(" "));
}

/** Jaccard similarity between two word sets: |intersection| / |union|. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Longest common subsequence length between two strings. */
function lcsLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;

  // Use two rows to save memory
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[n];
}

/** LCS ratio: 2 * lcs / (len(a) + len(b)). Returns 0-1. */
function lcsRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const lcs = lcsLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

/**
 * Combine Jaccard (word-level) and LCS ratio (character-level) for string similarity.
 * Weights: 50/50 blend.
 */
function stringSimilarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);

  const jaccard = jaccardSimilarity(wordSet(normA), wordSet(normB));
  const lcs = lcsRatio(normA, normB);

  return 0.5 * jaccard + 0.5 * lcs;
}

/** Duration similarity: 1.0 if within tolerance, degrades linearly beyond that. */
function durationSimilarity(
  aMs: number | undefined,
  bMs: number | undefined,
): number {
  if (aMs == null || bMs == null) {
    // If either is missing, return neutral (don't penalize or reward)
    return 0.5;
  }

  const diff = Math.abs(aMs - bMs);
  if (diff <= DURATION_TOLERANCE_MS) return 1.0;

  // Linear falloff: 0 at 30s difference
  const maxDiff = 30000;
  return Math.max(0, 1 - (diff - DURATION_TOLERANCE_MS) / maxDiff);
}

function assignConfidence(
  score: number,
  options: MatchOptions,
): "high" | "review" | "low" {
  if (score >= options.autoAcceptThreshold) return "high";
  if (score >= options.reviewThreshold) return "review";
  return "low";
}

export class FuzzyMatchStrategy implements MatchStrategy {
  readonly name = "fuzzy";
  private readonly options: MatchOptions;

  constructor(options: MatchOptions) {
    this.options = options;
  }

  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[] {
    const results: MatchResult[] = [];

    for (const candidate of candidates) {
      const titleScore = stringSimilarity(source.title, candidate.title);
      const artistScore = stringSimilarity(source.artist, candidate.artist);
      const durationScore = durationSimilarity(
        source.durationMs,
        candidate.durationMs,
      );

      const score =
        TITLE_WEIGHT * titleScore +
        ARTIST_WEIGHT * artistScore +
        DURATION_WEIGHT * durationScore;

      if (score >= MIN_THRESHOLD) {
        results.push({
          candidate,
          score,
          confidence: assignConfidence(score, this.options),
          method: this.name,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
