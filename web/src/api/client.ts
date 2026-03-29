const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Playlists
  getPlaylists: () => request<Playlist[]>("/playlists"),
  getPlaylist: (id: string) => request<Playlist>(`/playlists/${id}`),
  getPlaylistTracks: (id: string) => request<Track[]>(`/playlists/${id}/tracks`),
  renamePlaylist: (id: string, name: string) =>
    request<{ ok: boolean }>(`/playlists/${id}/rename`, { method: "PUT", body: JSON.stringify({ name }) }),
  deletePlaylist: (id: string) =>
    request<{ ok: boolean }>(`/playlists/${id}`, { method: "DELETE" }),
  pushPlaylist: (id: string) =>
    request<PushResult>(`/playlists/${id}/push`, { method: "POST" }),
  updatePlaylistMeta: (id: string, meta: PlaylistMeta) =>
    request<{ ok: boolean }>(`/playlists/${id}`, { method: "PATCH", body: JSON.stringify(meta) }),
  bulkRename: (params: BulkRenameParams) =>
    request<BulkRenameResult>("/playlists/bulk-rename", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  syncPlaylists: () =>
    request<SyncResult>("/playlists/sync", { method: "POST" }),

  // Tracks
  getTracks: (q?: string) => request<Track[]>(`/tracks${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getTrack: (id: string) => request<Track>(`/tracks/${id}`),
  getTrackLifecycle: (id: string) => request<TrackLifecycle>(`/tracks/${id}/lifecycle`),
  getTrackRejections: (id: string) => request<Rejection[]>(`/tracks/${id}/rejections`),

  // Review
  getReviewPending: () => request<PendingReviewItem[]>("/review"),
  getReviewStats: () => request<ReviewStats>("/review/stats"),
  confirmReview: (id: string) =>
    request<{ ok: boolean }>(`/review/${id}/confirm`, { method: "POST" }),
  rejectReview: (id: string) =>
    request<{ ok: boolean }>(`/review/${id}/reject`, { method: "POST" }),
  bulkConfirmReviews: (ids: string[]) =>
    request<{ ok: boolean; count: number }>("/review/bulk", {
      method: "POST",
      body: JSON.stringify({ action: "confirm", ids }),
    }),
  bulkRejectReviews: (ids: string[]) =>
    request<{ ok: boolean; count: number }>("/review/bulk", {
      method: "POST",
      body: JSON.stringify({ action: "reject", ids }),
    }),

  // Matches
  getMatches: (status?: string) =>
    request<MatchWithTrack[]>(`/matches${status ? `?status=${status}` : ""}`),

  // Downloads
  getDownloads: (status?: string) =>
    request<DownloadWithTrack[]>(`/downloads${status ? `?status=${status}` : ""}`),

  // Wishlist
  runWishlist: () =>
    request<{ ok: boolean; jobId: string }>("/wishlist/run", { method: "POST" }),

  // Status
  getStatus: () => request<HealthStatus>("/status"),
  getConfig: () => request<AppConfig>("/status/config"),
  updateConfig: (config: Partial<AppConfig>) =>
    request<{ ok: boolean }>("/status/config", { method: "PUT", body: JSON.stringify(config) }),

  // Spotify auth
  startSpotifyLogin: () =>
    request<{ ok: boolean; authUrl?: string; error?: string }>("/status/spotify/login", { method: "POST" }),
  getSpotifyAuthStatus: () =>
    request<{ authenticated: boolean; pending: boolean }>("/status/spotify/auth-status"),
  spotifyLogout: () =>
    request<{ ok: boolean }>("/status/spotify/login", { method: "DELETE" }),

  // Soulseek
  connectSoulseek: (params: { slskdUrl: string; slskdApiKey: string }) =>
    request<{ ok: boolean; error?: string }>("/status/soulseek/connect", {
      method: "PUT",
      body: JSON.stringify(params),
    }),
  disconnectSoulseek: () =>
    request<{ ok: boolean }>("/status/soulseek/connect", { method: "DELETE" }),

  // Sync
  startSync: (playlistId: string) =>
    request<{ syncId: string; jobId?: string }>(`/sync/${playlistId}`, { method: "POST" }),
  dryRunSync: (playlistId: string) =>
    request<DryRunResult>(`/sync/${playlistId}/dry-run`, { method: "POST" }),
  getSyncStatus: (syncId: string) => request<SyncStatus>(`/sync/${syncId}`),
  syncEvents: (syncId: string) => new EventSource(`${BASE}/sync/${syncId}/events`),

  // Jobs
  getJobs: (params?: { type?: string; status?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set("type", params.type);
    if (params?.status) qs.set("status", params.status);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const q = qs.toString();
    return request<JobListResponse>(`/jobs${q ? `?${q}` : ""}`);
  },
  getJob: (id: string) => request<JobDetail>(`/jobs/${id}`),
  getJobStats: () => request<JobStats>("/jobs/stats"),
  retryJob: (id: string) =>
    request<{ ok: boolean }>(`/jobs/${id}/retry`, { method: "POST" }),
  cancelJob: (id: string) =>
    request<{ ok: boolean }>(`/jobs/${id}`, { method: "DELETE" }),
  retryAllJobs: (type?: string) =>
    request<{ retried: number }>("/jobs/retry-all", {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
  jobEvents: () => new EventSource(`${BASE}/jobs/stream`),
};

// Types (mirrors API responses)

export interface Playlist {
  id: string;
  spotifyId: string | null;
  name: string;
  description: string | null;
  snapshotId: string | null;
  isOwned: number | null;
  ownerId: string | null;
  ownerName: string | null;
  tags: string | null;
  notes: string | null;
  pinned: number | null;
  lastSynced: number | null;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistMeta {
  tags?: string[];
  notes?: string;
  pinned?: boolean;
}

export interface Track {
  id: string;
  spotifyId: string | null;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  isrc: string | null;
  spotifyUri: string | null;
  position?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Match {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
  status: "pending" | "confirmed" | "rejected";
  parkedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LexiconTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  lastSynced: number;
}

export interface MatchWithTrack extends Match {
  sourceTrack: Track | null;
  targetTrack: LexiconTrack | null;
}

export interface PendingReviewItem {
  matchId: string;
  spotifyTrack: Track;
  lexiconTrack: LexiconTrack;
  score: number;
  confidence: string;
  method: string;
  playlistName: string;
  parkedAt: number;
}

export interface ReviewStats {
  pending: number;
  confirmedToday: number;
  rejectedToday: number;
}

export interface Rejection {
  id: string;
  trackId: string;
  context: "lexicon_match" | "soulseek_download";
  fileKey: string | null;
  targetTrackId: string | null;
  reason: string | null;
  createdAt: number;
}

export interface DownloadWithTrack {
  id: string;
  trackId: string;
  playlistId: string | null;
  origin: "not_found" | "review_rejected";
  status: string;
  soulseekPath: string | null;
  filePath: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  track: Track | null;
}

export interface HealthStatus {
  spotify: { ok: boolean; error?: string };
  lexicon: { ok: boolean; error?: string };
  soulseek: { ok: boolean; error?: string };
  database: { ok: boolean; playlists?: number; tracks?: number; matches?: number; downloads?: number; error?: string };
}

export interface AppConfig {
  matching: { autoAcceptThreshold: number; reviewThreshold: number };
  download: { formats: string[]; minBitrate: number; concurrency: number; validationStrictness: string };
}

export interface DryRunResult {
  playlistName: string;
  found: MatchedTrack[];
  needsReview: MatchedTrack[];
  notFound: Array<{ dbTrackId: string; track: { title: string; artist: string } }>;
  total: number;
}

export interface MatchedTrack {
  dbTrackId: string;
  track: { title: string; artist: string };
  lexiconTrackId?: string;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

export interface SyncStatus {
  syncId: string;
  playlistId: string;
  status: "running" | "done" | "error";
  eventCount: number;
}

export interface SyncResult {
  ok: boolean;
  added: number;
  updated: number;
  unchanged: number;
}

// Track lifecycle

export interface TrackLifecycle {
  track: Track;
  playlists: Array<{ playlistId: string; position: number; playlistName: string }>;
  matches: Match[];
  downloads: DownloadWithTrack[];
  jobs: JobItem[];
}

// Job types

export interface JobItem {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  priority: number;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  maxAttempts: number;
  runAfter: number | null;
  parentJobId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

export interface JobDetail extends JobItem {
  children: JobItem[];
}

export interface JobListResponse {
  jobs: JobItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface JobStats {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

export interface PushResult {
  ok: boolean;
  renamed: boolean;
  descriptionUpdated: boolean;
  added: number;
  removed: number;
  message?: string;
}

export interface BulkRenameParams {
  pattern: string;
  replacement: string;
  dryRun: boolean;
}

export interface BulkRenamePreview {
  id: string;
  name: string;
  newName: string;
}

export type BulkRenameResult = BulkRenamePreview[];
