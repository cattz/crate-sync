import type { TrackInfo, MatchResult } from "../types/common.js";
import type {
  MatchStrategy,
  FuzzyMatchConfig,
  WeightProfile,
  MatchContext,
} from "./types.js";
import {
  normalizeBase,
  normalizeArtist,
  normalizeTitle,
  removeStopwords,
  stripRemixSuffix,
} from "./normalize.js";

const MIN_THRESHOLD = 0.3;

const WEIGHT_PRESETS: Record<MatchContext, WeightProfile> = {
  lexicon: { title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 },
  soulseek: { title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 },
  "post-download": { title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 },
};

const DEFAULT_WEIGHTS: WeightProfile = WEIGHT_PRESETS.lexicon;

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

/**
 * Damerau-Levenshtein distance: handles insertions, deletions,
 * substitutions, and transpositions of adjacent characters.
 */
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use matrix for full Damerau-Levenshtein (not optimal-string-alignment)
  const d: number[][] = Array.from({ length: m + 2 }, () =>
    new Array<number>(n + 2).fill(0),
  );

  const maxDist = m + n;
  d[0][0] = maxDist;

  for (let i = 0; i <= m; i++) {
    d[i + 1][0] = maxDist;
    d[i + 1][1] = i;
  }
  for (let j = 0; j <= n; j++) {
    d[0][j + 1] = maxDist;
    d[1][j + 1] = j;
  }

  const da: Record<string, number> = {};

  for (let i = 1; i <= m; i++) {
    let db = 0;
    for (let j = 1; j <= n; j++) {
      const i1 = da[b[j - 1]] || 0;
      const j1 = db;
      let cost = 1;
      if (a[i - 1] === b[j - 1]) {
        cost = 0;
        db = j;
      }
      d[i + 1][j + 1] = Math.min(
        d[i][j] + cost, // substitution
        d[i + 1][j] + 1, // insertion
        d[i][j + 1] + 1, // deletion
        d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1), // transposition
      );
    }
    da[a[i - 1]] = i;
  }

  return d[m + 1][n + 1];
}

/** Edit distance similarity: 1 - dist / max(len1, len2). */
function editSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dist = damerauLevenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * String similarity: max of Jaccard (with stopword removal) and edit distance.
 * Takes pre-normalized strings.
 */
function stringSimilarity(normA: string, normB: string): number {
  const wordsA = removeStopwords(wordSet(normA));
  const wordsB = removeStopwords(wordSet(normB));
  const jaccard = jaccardSimilarity(wordsA, wordsB);
  const edit = editSimilarity(normA, normB);
  return Math.max(jaccard, edit);
}

/**
 * Artist similarity with containment floor:
 * if one normalized artist contains the other, floor at 0.7.
 * Handles "Artist feat. Other" vs "Artist" cases.
 */
function artistSimilarity(normA: string, normB: string): number {
  const base = stringSimilarity(normA, normB);
  if (normA.length > 0 && normB.length > 0) {
    if (normA.includes(normB) || normB.includes(normA)) {
      return Math.max(base, 0.7);
    }
  }
  return base;
}

/** Duration similarity: smooth power decay. max(0, 1 - (diff/30000)^1.5) */
function durationSimilarity(
  aMs: number | undefined,
  bMs: number | undefined,
): number {
  if (aMs == null && bMs == null) return 1.0; // both missing → no penalty
  if (aMs == null || bMs == null) return 0.5; // one missing → uncertain
  const diff = Math.abs(aMs - bMs);
  return Math.max(0, 1 - Math.pow(diff / 30000, 1.5));
}

function assignConfidence(
  score: number,
  config: FuzzyMatchConfig,
): "high" | "review" | "low" {
  if (score >= config.autoAcceptThreshold) return "high";
  if (score >= config.reviewThreshold) return "review";
  return "low";
}

export class FuzzyMatchStrategy implements MatchStrategy {
  readonly name = "fuzzy";
  private readonly config: FuzzyMatchConfig;
  private readonly weights: WeightProfile;

  constructor(config: FuzzyMatchConfig) {
    this.config = config;
    this.weights =
      config.weights ??
      (config.context ? WEIGHT_PRESETS[config.context] : DEFAULT_WEIGHTS);
  }

  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[] {
    const results: MatchResult[] = [];

    const srcTitle = normalizeBase(source.title);
    const srcArtist = normalizeArtist(source.artist);
    const srcAlbum = source.album ? normalizeBase(source.album) : undefined;

    for (const candidate of candidates) {
      const candTitle = normalizeBase(candidate.title);
      const candArtist = normalizeArtist(candidate.artist);
      const candAlbum = candidate.album
        ? normalizeBase(candidate.album)
        : undefined;

      // Artist gate: early rejection for soulseek context
      const artScore = artistSimilarity(srcArtist, candArtist);
      if (
        this.config.artistRejectThreshold != null &&
        artScore < this.config.artistRejectThreshold
      ) {
        continue;
      }

      // Title score with remix fallback, then DJ suffix fallback
      let titleScore = stringSimilarity(srcTitle, candTitle);
      if (titleScore < this.config.reviewThreshold) {
        // Try stripping remix suffixes
        const strippedSrc = normalizeBase(stripRemixSuffix(source.title));
        const strippedCand = normalizeBase(stripRemixSuffix(candidate.title));
        if (strippedSrc !== srcTitle || strippedCand !== candTitle) {
          titleScore = Math.max(
            titleScore,
            stringSimilarity(strippedSrc, strippedCand),
          );
        }
      }
      if (titleScore < this.config.reviewThreshold) {
        // Try stripping all DJ suffixes (parenthetical, key/BPM, feat.)
        const djSrc = normalizeBase(normalizeTitle(source.title));
        const djCand = normalizeBase(normalizeTitle(candidate.title));
        if (djSrc !== srcTitle || djCand !== candTitle) {
          titleScore = Math.max(
            titleScore,
            stringSimilarity(djSrc, djCand),
          );
        }
      }

      const durScore = durationSimilarity(
        source.durationMs,
        candidate.durationMs,
      );

      // Album score with weight redistribution when missing
      let { title: wT, artist: wA, album: wAl, duration: wD } = this.weights;

      let albumScore = 0;
      if (srcAlbum != null && candAlbum != null) {
        albumScore = stringSimilarity(srcAlbum, candAlbum);
      } else {
        // Redistribute album weight proportionally to title + artist + duration
        const sumOther = wT + wA + wD;
        if (sumOther > 0) {
          wT += wAl * (wT / sumOther);
          wA += wAl * (wA / sumOther);
          wD += wAl * (wD / sumOther);
        }
        wAl = 0;
      }

      const score =
        wT * titleScore + wA * artScore + wAl * albumScore + wD * durScore;

      if (score >= MIN_THRESHOLD) {
        results.push({
          candidate,
          score,
          confidence: assignConfidence(score, this.config),
          method: this.name,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
