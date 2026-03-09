import type { TrackInfo, MatchResult } from "../types/common.js";
import type { MatchStrategy } from "./types.js";

export class IsrcMatchStrategy implements MatchStrategy {
  readonly name = "isrc";

  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[] {
    if (!source.isrc) {
      return [];
    }

    const sourceIsrc = source.isrc.toUpperCase();
    const results: MatchResult[] = [];

    for (const candidate of candidates) {
      if (!candidate.isrc) {
        continue;
      }

      if (candidate.isrc.toUpperCase() === sourceIsrc) {
        results.push({
          candidate,
          score: 1.0,
          confidence: "high",
          method: this.name,
        });
      }
    }

    return results;
  }
}
