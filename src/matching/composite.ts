import type { TrackInfo, MatchResult } from "../types/common.js";
import type { MatchStrategy, MatchOptions } from "./types.js";

function assignConfidence(
  score: number,
  options: MatchOptions,
): "high" | "review" | "low" {
  if (score >= options.autoAcceptThreshold) return "high";
  if (score >= options.reviewThreshold) return "review";
  return "low";
}

export class CompositeMatchStrategy implements MatchStrategy {
  readonly name = "composite";
  private readonly strategies: MatchStrategy[];
  private readonly options: MatchOptions;

  constructor(strategies: MatchStrategy[], options: MatchOptions) {
    this.strategies = strategies;
    this.options = options;
  }

  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[] {
    for (const strategy of this.strategies) {
      const results = strategy.match(source, candidates);
      const highConfidence = results.find((r) => r.confidence === "high");

      if (highConfidence) {
        return results;
      }
    }

    // No high-confidence match found — merge all results, keeping best score per candidate
    const bestByCandidate = new Map<TrackInfo, MatchResult>();

    for (const strategy of this.strategies) {
      const results = strategy.match(source, candidates);

      for (const result of results) {
        const existing = bestByCandidate.get(result.candidate);
        if (!existing || result.score > existing.score) {
          bestByCandidate.set(result.candidate, result);
        }
      }
    }

    // Reassign confidence based on composite thresholds
    const merged = Array.from(bestByCandidate.values()).map((result) => ({
      ...result,
      confidence: assignConfidence(result.score, this.options),
      method: "composite",
    }));

    merged.sort((a, b) => b.score - a.score);
    return merged;
  }
}
