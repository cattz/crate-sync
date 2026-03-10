import type { LexiconTrack, LexiconPlaylist } from "../types/lexicon.js";
import type { LexiconConfig } from "../config.js";
import { withRetry } from "../utils/retry.js";

/** Normalize an ID (int or string) to string */
function normalizeId(id: unknown): string {
  return String(id);
}

/** Unwrap Lexicon API responses which may be wrapped in various ways */
function unwrapResponse<T>(body: unknown, key: string): T {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    // { data: { ... } } or { data: [...] }
    if ("data" in obj) return obj.data as T;
    // { tracks: [...] } or { playlists: [...] }
    if (key in obj) return obj[key] as T;
  }
  // bare array or object
  return body as T;
}

function normalizeLexiconTrack(raw: Record<string, unknown>): LexiconTrack {
  // Duration: API returns seconds in `duration`, convert to ms
  let durationMs: number | undefined;
  if (raw.duration != null) {
    durationMs = Math.round(Number(raw.duration) * 1000);
  } else if (raw.durationMs != null) {
    durationMs = Number(raw.durationMs);
  } else if (raw.duration_ms != null) {
    durationMs = Number(raw.duration_ms);
  }

  return {
    id: normalizeId(raw.id),
    filePath: String(raw.location ?? raw.filePath ?? raw.file_path ?? ""),
    title: String(raw.title ?? ""),
    artist: String(raw.artist ?? ""),
    album: raw.albumTitle != null ? String(raw.albumTitle) : raw.album != null ? String(raw.album) : undefined,
    durationMs,
  };
}

function normalizeLexiconPlaylist(
  raw: Record<string, unknown>,
): LexiconPlaylist {
  const trackIds = Array.isArray(raw.trackIds ?? raw.track_ids)
    ? (raw.trackIds ?? raw.track_ids) as unknown[]
    : [];
  return {
    id: normalizeId(raw.id),
    name: String(raw.name ?? ""),
    trackIds: trackIds.map(normalizeId),
  };
}

export class LexiconService {
  private baseUrl: string;

  constructor(private config: LexiconConfig) {
    // Strip trailing slash and append /v1
    this.baseUrl = config.url.replace(/\/+$/, "") + "/v1";
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    return withRetry(async () => {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "<no body>");
        throw new Error(
          `Lexicon API error: ${response.status} ${response.statusText} — ${body}`,
        );
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    });
  }

  /** Test connection to Lexicon */
  async ping(): Promise<boolean> {
    try {
      await this.request("/tracks?limit=1");
      return true;
    } catch {
      return false;
    }
  }

  /** Get all tracks from the Lexicon library */
  async getTracks(): Promise<LexiconTrack[]> {
    const raw = await this.request<unknown>("/tracks");
    const tracks = unwrapResponse<Record<string, unknown>[]>(raw, "tracks");
    return tracks.map(normalizeLexiconTrack);
  }

  /** Search tracks by artist and/or title using bracket filter syntax */
  async searchTracks(query: {
    artist?: string;
    title?: string;
  }): Promise<LexiconTrack[]> {
    const params = new URLSearchParams();
    if (query.artist) params.set("filter[artist]", query.artist);
    if (query.title) params.set("filter[title]", query.title);

    const qs = params.toString();
    const path = qs ? `/tracks?${qs}` : "/tracks";
    const raw = await this.request<unknown>(path);
    const tracks = unwrapResponse<Record<string, unknown>[]>(raw, "tracks");
    return tracks.map(normalizeLexiconTrack);
  }

  /** Get a single track by ID */
  async getTrack(id: string): Promise<LexiconTrack | null> {
    try {
      const raw = await this.request<unknown>(`/tracks/${id}`);
      const track = unwrapResponse<Record<string, unknown>>(raw, "track");
      return normalizeLexiconTrack(track);
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) return null;
      throw err;
    }
  }

  /** Get all playlists */
  async getPlaylists(): Promise<LexiconPlaylist[]> {
    const raw = await this.request<unknown>("/playlists");
    const playlists = unwrapResponse<Record<string, unknown>[]>(
      raw,
      "playlists",
    );
    return playlists.map(normalizeLexiconPlaylist);
  }

  /** Get a playlist by name */
  async getPlaylistByName(name: string): Promise<LexiconPlaylist | null> {
    const all = await this.getPlaylists();
    return all.find((p) => p.name === name) ?? null;
  }

  /** Create a new playlist */
  async createPlaylist(
    name: string,
    trackIds: string[],
  ): Promise<LexiconPlaylist> {
    const raw = await this.request<unknown>("/playlists", {
      method: "POST",
      body: JSON.stringify({ name, trackIds }),
    });
    const playlist = unwrapResponse<Record<string, unknown>>(raw, "playlist");
    return normalizeLexiconPlaylist(playlist);
  }

  /**
   * Add tracks to a playlist (REPLACE semantics handled internally).
   * Fetches the current playlist, merges new trackIds, then sends the
   * full list back via PUT.
   *
   * @param positions - optional array of insertion indices (one per trackId).
   *   If omitted, new tracks are appended at the end.
   */
  async addTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
    positions?: number[],
  ): Promise<void> {
    // Fetch current state
    const raw = await this.request<unknown>(`/playlists/${playlistId}`);
    const current = unwrapResponse<Record<string, unknown>>(raw, "playlist");
    const playlist = normalizeLexiconPlaylist(current);
    const merged = [...playlist.trackIds];

    if (positions && positions.length === trackIds.length) {
      // Insert at specified positions (process in reverse to keep indices stable)
      const insertions = trackIds
        .map((id, i) => ({ id, pos: positions[i] }))
        .sort((a, b) => b.pos - a.pos);
      for (const { id, pos } of insertions) {
        const clampedPos = Math.min(Math.max(0, pos), merged.length);
        merged.splice(clampedPos, 0, id);
      }
    } else {
      // Append new tracks that aren't already present
      const existingSet = new Set(merged);
      for (const id of trackIds) {
        if (!existingSet.has(id)) {
          merged.push(id);
        }
      }
    }

    await this.setPlaylistTracks(playlistId, merged);
  }

  /** Set the full track list for a playlist (for reordering or full replace) */
  async setPlaylistTracks(
    playlistId: string,
    trackIds: string[],
  ): Promise<void> {
    await this.request(`/playlists/${playlistId}`, {
      method: "PUT",
      body: JSON.stringify({ trackIds }),
    });
  }
}
