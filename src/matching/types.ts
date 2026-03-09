import type { TrackInfo, MatchResult } from "../types/common.js";

export interface MatchStrategy {
  name: string;
  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[];
}

export interface MatchOptions {
  autoAcceptThreshold: number;
  reviewThreshold: number;
}
