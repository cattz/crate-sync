/** In-memory state for active sync operations. */

export interface SyncEvent {
  type: string;
  data: unknown;
}

export type SyncStatus = "running" | "awaiting-review" | "done" | "error";

export interface SyncState {
  playlistId: string;
  status: SyncStatus;
  events: SyncEvent[];
  listeners: Set<(event: SyncEvent) => Promise<void>>;
  reviewDecisions?: Array<{ dbTrackId: string; accepted: boolean }>;
}

/** Active sync sessions keyed by syncId. */
export const syncState = new Map<string, SyncState>();
