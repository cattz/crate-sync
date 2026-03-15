import type { TrackInfo, MatchResult } from "../types/common.js";

export interface MatchStrategy {
  name: string;
  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[];
}

export interface MatchOptions {
  autoAcceptThreshold: number;
  reviewThreshold: number;
}

export type MatchContext = "lexicon" | "soulseek" | "post-download";

export interface WeightProfile {
  title: number;
  artist: number;
  album: number;
  duration: number;
}

export interface FuzzyMatchConfig extends MatchOptions {
  context?: MatchContext;
  weights?: WeightProfile;
  artistRejectThreshold?: number;
}
