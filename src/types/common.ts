export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  uri?: string;
}

export interface MatchResult {
  candidate: TrackInfo;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

export type SyncPhase = "match" | "review" | "download";

export type DownloadStatus =
  | "pending"
  | "searching"
  | "downloading"
  | "validating"
  | "moving"
  | "done"
  | "failed";

export type MatchStatus = "pending" | "confirmed" | "rejected";
