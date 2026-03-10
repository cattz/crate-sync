import type { LexiconTrack, LexiconPlaylist } from "../types/lexicon.js";
import type { LexiconConfig } from "../config.js";
import { withRetry } from "../utils/retry.js";

/** Normalize an ID (int or string) to string */
function normalizeId(id: unknown): string {
  return String(id);
}

/** Unwrap Lexicon API responses which may be wrapped in various ways */
function unwrapResponse<T>(body: unknown, key: string): T {
  let current = body;

  // Peel off up to 2 layers of wrapping (e.g. { data: { tracks: [...] } })
  for (let i = 0; i < 2; i++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    const obj = current as Record<string, unknown>;

    if (key in obj) return obj[key] as T;
    if ("content" in obj && Array.isArray(obj.content)) return obj.content as T;
    if ("data" in obj) { current = obj.data; continue; }
    break;
  }

  return current as T;
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

/** Recursively search the playlist tree for a playlist by name */
function findPlaylistInTree(
  nodes: Record<string, unknown>[],
  name: string,
): Record<string, unknown> | null {
  for (const node of nodes) {
    if (String(node.name ?? "") === name) return node;
    const children = node.playlists;
    if (Array.isArray(children)) {
      const found = findPlaylistInTree(children as Record<string, unknown>[], name);
      if (found) return found;
    }
  }
  return null;
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

  /** Search tracks by artist and/or title (client-side filtering since API has no search endpoint) */
  async searchTracks(query: {
    artist?: string;
    title?: string;
  }): Promise<LexiconTrack[]> {
    const all = await this.getTracks();
    return all.filter((t) => {
      if (query.artist && !t.artist.toLowerCase().includes(query.artist.toLowerCase())) {
        return false;
      }
      if (query.title && !t.title.toLowerCase().includes(query.title.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  /** Get a single track by ID */
  async getTrack(id: string): Promise<LexiconTrack | null> {
    try {
      const raw = await this.request<unknown>(`/track?id=${id}`);
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

  /** Get a playlist by name (searches recursively through the tree) */
  async getPlaylistByName(name: string): Promise<LexiconPlaylist | null> {
    const raw = await this.request<unknown>("/playlists");
    const tree = unwrapResponse<Record<string, unknown>[]>(raw, "playlists");
    if (!Array.isArray(tree)) return null;

    const found = findPlaylistInTree(tree, name);
    return found ? normalizeLexiconPlaylist(found) : null;
  }

  /** Create a new playlist, then add tracks to it */
  async createPlaylist(
    name: string,
    trackIds: string[],
  ): Promise<LexiconPlaylist> {
    const raw = await this.request<unknown>("/playlist", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const playlist = unwrapResponse<Record<string, unknown>>(raw, "playlist");
    const result = normalizeLexiconPlaylist(playlist);

    if (trackIds.length > 0) {
      await this.request("/playlist-tracks", {
        method: "PATCH",
        body: JSON.stringify({ id: Number(result.id), trackIds: trackIds.map(Number) }),
      });
    }

    return result;
  }

  /** Add tracks to a playlist (appends via PATCH /playlist-tracks) */
  async addTracksToPlaylist(
    playlistId: string,
    trackIds: string[],
  ): Promise<void> {
    if (trackIds.length === 0) return;
    await this.request("/playlist-tracks", {
      method: "PATCH",
      body: JSON.stringify({ id: Number(playlistId), trackIds: trackIds.map(Number) }),
    });
  }

  /** Set the full track list for a playlist (delete existing, then add new) */
  async setPlaylistTracks(
    playlistId: string,
    trackIds: string[],
  ): Promise<void> {
    const id = Number(playlistId);

    // Get current tracks to delete them
    const raw = await this.request<unknown>(`/playlist?id=${playlistId}`);
    const current = unwrapResponse<Record<string, unknown>>(raw, "playlist");
    const existing = normalizeLexiconPlaylist(current);

    if (existing.trackIds.length > 0) {
      await this.request("/playlist-tracks", {
        method: "DELETE",
        body: JSON.stringify({ id, trackIds: existing.trackIds.map(Number) }),
      });
    }

    if (trackIds.length > 0) {
      await this.request("/playlist-tracks", {
        method: "PATCH",
        body: JSON.stringify({ id, trackIds: trackIds.map(Number) }),
      });
    }
  }
}
