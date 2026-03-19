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

  // Tracks
  getTracks: (q?: string) => request<Track[]>(`/tracks${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getTrack: (id: string) => request<Track>(`/tracks/${id}`),
  getTrackLifecycle: (id: string) => request<TrackLifecycle>(`/tracks/${id}/lifecycle`),

  // Matches
  getMatches: (status?: string) =>
    request<MatchWithTrack[]>(`/matches${status ? `?status=${status}` : ""}`),
  updateMatch: (id: string, status: "confirmed" | "rejected") =>
    request<Match>(`/matches/${id}`, { method: "PUT", body: JSON.stringify({ status }) }),

  // Downloads
  getDownloads: (status?: string) =>
    request<DownloadWithTrack[]>(`/downloads${status ? `?status=${status}` : ""}`),

  // Status
  getStatus: () => request<HealthStatus>("/status"),
  getConfig: () => request<AppConfig>("/status/config"),
  updateConfig: (config: Partial<AppConfig>) =>
    request<{ ok: boolean }>("/status/config", { method: "PUT", body: JSON.stringify(config) }),

  // Sync
  startSync: (playlistId: string) =>
    request<{ syncId: string; jobId?: string }>(`/sync/${playlistId}`, { method: "POST" }),
  dryRunSync: (playlistId: string) =>
    request<PhaseOneResult>(`/sync/${playlistId}/dry-run`, { method: "POST" }),
  getSyncStatus: (syncId: string) => request<SyncStatus>(`/sync/${syncId}`),
  submitReview: (syncId: string, decisions: ReviewDecision[]) =>
    request<{ ok: boolean }>(`/sync/${syncId}/review`, {
      method: "POST",
      body: JSON.stringify({ decisions }),
    }),
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
  lastSynced: number | null;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
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

export interface DownloadWithTrack {
  id: string;
  trackId: string;
  playlistId: string | null;
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
  download: { formats: string[]; minBitrate: number; concurrency: number };
}

export interface PhaseOneResult {
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
  status: "running" | "awaiting-review" | "done" | "error";
  eventCount: number;
}

export interface ReviewDecision {
  dbTrackId: string;
  accepted: boolean;
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
