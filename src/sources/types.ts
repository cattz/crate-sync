import type { TrackInfo } from "../types/common.js";

export interface SourceCandidate {
  /** Unique key for rejection tracking (e.g. "local:lossless:/path/to/file.flac"). */
  sourceKey: string;
  /** Source identifier (e.g. "local:lossless", "soulseek"). */
  sourceId: string;
  /** Parsed track metadata from filename or tags. */
  trackInfo: TrackInfo;
  /** Set if the file is already on disk. */
  localPath?: string;
  /** Source-specific metadata. */
  meta: Record<string, unknown>;
  quality?: {
    format?: string;
    bitRate?: number;
  };
}

export interface AcquiredFile {
  localPath: string;
  candidate: SourceCandidate;
}

export interface TrackSource {
  readonly id: string;
  readonly name: string;
  /** Check whether this source is reachable (e.g. volume mounted). */
  isAvailable(): Promise<boolean>;
  /** Search for candidates matching the given track. */
  search(track: TrackInfo, trackId: string): Promise<SourceCandidate[]>;
  /** Acquire (copy/move) a candidate file to a temp location. */
  acquire(candidate: SourceCandidate): Promise<AcquiredFile | null>;
  /** Poll for an async acquisition that was started earlier. */
  checkAcquisition?(candidate: SourceCandidate): Promise<AcquiredFile | null>;
}
