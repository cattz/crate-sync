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
    request<{ syncId: string }>(`/sync/${playlistId}`, { method: "POST" }),
  dryRunSync: (playlistId: string) =>
    request<PhaseOneResult>(`/sync/${playlistId}/dry-run`, { method: "POST" }),
  getSyncStatus: (syncId: string) => request<SyncStatus>(`/sync/${syncId}`),
  submitReview: (syncId: string, decisions: ReviewDecision[]) =>
    request<{ ok: boolean }>(`/sync/${syncId}/review`, {
      method: "POST",
      body: JSON.stringify({ decisions }),
    }),
  syncEvents: (syncId: string) => new EventSource(`${BASE}/sync/${syncId}/events`),
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

export interface MatchWithTrack extends Match {
  sourceTrack: Track | null;
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
