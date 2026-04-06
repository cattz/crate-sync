import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { SpotifyConfig } from "../config.js";
import type { SpotifyPlaylist, SpotifyTrack } from "../types/spotify.js";
import { withRetry } from "../utils/retry.js";
import {
  composeDescription,
  parseDescription,
} from "../utils/description.js";

const API_BASE = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTH_URL = "https://accounts.spotify.com/authorize";

const DEFAULT_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
];

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function getTokenPath(): string {
  return join(homedir(), ".config", "crate-sync", "spotify-tokens.json");
}

/**
 * Spotify API adapter — handles authentication and HTTP calls to the Spotify Web API.
 * No database access; persistence is handled by PlaylistService.
 */
export class SpotifyApiClient {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private refreshToken: string | null = null;
  private tokensLoaded = false;

  constructor(private config: SpotifyConfig) {}

  // ---------------------------------------------------------------------------
  // Token persistence
  // ---------------------------------------------------------------------------

  private loadTokens(): void {
    if (this.tokensLoaded) return;
    this.tokensLoaded = true;

    const tokenPath = getTokenPath();
    if (!existsSync(tokenPath)) return;

    try {
      const raw = readFileSync(tokenPath, "utf-8");
      const stored: StoredTokens = JSON.parse(raw);
      this.accessToken = stored.accessToken;
      this.refreshToken = stored.refreshToken;
      this.tokenExpiry = stored.expiresAt;
    } catch {
      // Corrupt file — ignore and require re-auth
    }
  }

  private saveTokens(): void {
    if (!this.accessToken || !this.refreshToken) return;

    const tokenPath = getTokenPath();
    const dir = dirname(tokenPath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const stored: StoredTokens = {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.tokenExpiry,
    };

    writeFileSync(tokenPath, JSON.stringify(stored, null, 2) + "\n", "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: DEFAULT_SCOPES.join(" "),
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new Error(
        `Spotify token exchange failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    this.tokensLoaded = true;

    this.saveTokens();
  }

  async isAuthenticated(): Promise<boolean> {
    this.loadTokens();

    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return true;
    }

    if (this.refreshToken) {
      try {
        await this.refreshAccessToken();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  setTokens(
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
  ): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiry = expiresAt;
    this.tokensLoaded = true;
    this.saveTokens();
  }

  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error("No refresh token available");
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new Error(
        `Spotify token refresh failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }

    this.saveTokens();
  }

  private async ensureToken(): Promise<string> {
    this.loadTokens();

    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    await this.refreshAccessToken();

    if (!this.accessToken) {
      throw new Error("Failed to obtain access token");
    }
    return this.accessToken;
  }

  // ---------------------------------------------------------------------------
  // Internal fetch helper
  // ---------------------------------------------------------------------------

  private async fetchApi(
    path: string,
    options: RequestInit = {},
    _retries = 0,
  ): Promise<unknown> {
    const MAX_RETRIES = 5;

    return withRetry(async () => {
      const token = await this.ensureToken();
      const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (response.status === 429) {
        if (_retries >= MAX_RETRIES) {
          throw new Error(`Spotify rate limit: gave up after ${MAX_RETRIES} retries`);
        }
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return this.fetchApi(path, options, _retries + 1);
      }

      if (response.status === 401) {
        if (_retries >= MAX_RETRIES) {
          throw new Error(`Spotify auth: gave up after ${MAX_RETRIES} token refresh attempts`);
        }
        await this.refreshAccessToken();
        return this.fetchApi(path, options, _retries + 1);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "<no body>");
        throw new Error(
          `Spotify API error: ${response.status} ${response.statusText} — ${body}`,
        );
      }

      if (response.status === 204) {
        return undefined;
      }

      const text = await response.text();
      if (!text) return undefined;

      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Response mappers
  // ---------------------------------------------------------------------------

  private mapPlaylist(raw: Record<string, unknown>): SpotifyPlaylist {
    const tracks = raw.tracks as Record<string, unknown> | undefined;
    const owner = raw.owner as Record<string, unknown> | undefined;
    return {
      id: String(raw.id),
      name: String(raw.name),
      description: raw.description ? String(raw.description) : undefined,
      snapshotId: String(raw.snapshot_id),
      trackCount: tracks ? Number(tracks.total) : 0,
      uri: String(raw.uri),
      ownerId: owner ? String(owner.id) : "",
      ownerName: owner ? String(owner.display_name ?? owner.id) : "",
    };
  }

  private mapTrack(raw: Record<string, unknown>, isLocal?: boolean): SpotifyTrack {
    const artists = (raw.artists as Array<Record<string, unknown>> | null) ?? [];
    const album = raw.album as Record<string, unknown> | null;
    const externalIds = (raw.external_ids as Record<string, unknown>) ?? {};

    return {
      id: String(raw.id ?? `local_${Date.now()}`),
      title: String(raw.name ?? ""),
      artist: artists.map((a) => String(a.name ?? "")).filter(Boolean).join(", ") || "(Unknown)",
      artists: artists.map((a) => String(a.name ?? "")).filter(Boolean),
      album: album ? String(album.name ?? "") : "",
      durationMs: Number(raw.duration_ms ?? 0),
      isrc: externalIds.isrc ? String(externalIds.isrc) : undefined,
      uri: String(raw.uri ?? ""),
      isLocal: isLocal ?? (raw.is_local === true),
    };
  }

  // ---------------------------------------------------------------------------
  // Playlists — API
  // ---------------------------------------------------------------------------

  async getPlaylistDetails(
    playlistId: string,
  ): Promise<{ name: string; description: string }> {
    const data = (await this.fetchApi(
      `/playlists/${playlistId}?fields=name,description`,
    )) as { name: string; description: string | null };
    return { name: data.name, description: data.description ?? "" };
  }

  async getPlaylists(): Promise<SpotifyPlaylist[]> {
    const result: SpotifyPlaylist[] = [];
    let url: string | null = "/me/playlists?limit=50";

    while (url) {
      const data = (await this.fetchApi(url)) as {
        items: Record<string, unknown>[];
        next: string | null;
      };

      for (const item of data.items) {
        result.push(this.mapPlaylist(item));
      }

      url = data.next;
    }

    return result;
  }

  async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    const result: SpotifyTrack[] = [];
    let url: string | null = `/playlists/${playlistId}/tracks?limit=100`;

    while (url) {
      const data = (await this.fetchApi(url)) as {
        items: Array<{ track: Record<string, unknown> | null; is_local?: boolean; added_at?: string }>;
        next: string | null;
      };

      for (const item of data.items) {
        if (!item.track) {
          // Null track object — create placeholder with whatever info we have
          result.push({
            id: `broken_${Date.now()}_${result.length}`,
            title: "(Unavailable track)",
            artist: "(Unknown)",
            album: "",
            durationMs: 0,
            uri: `spotify:local:::broken:${result.length}`,
            isLocal: true,
          });
          continue;
        }
        result.push(this.mapTrack(item.track, item.is_local));
      }

      url = data.next;
    }

    return result;
  }

  async getCurrentUserId(): Promise<string> {
    const me = (await this.fetchApi("/me")) as { id: string };
    return me.id;
  }

  // ---------------------------------------------------------------------------
  // Playlist mutations — API
  // ---------------------------------------------------------------------------

  async renamePlaylist(playlistId: string, name: string): Promise<void> {
    await this.fetchApi(`/playlists/${playlistId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  }

  async updatePlaylistDetails(
    playlistId: string,
    details: { name?: string; description?: string },
  ): Promise<void> {
    await this.fetchApi(`/playlists/${playlistId}`, {
      method: "PUT",
      body: JSON.stringify(details),
    });
  }

  async updatePlaylistDescription(
    playlistId: string,
    description: string,
  ): Promise<void> {
    await this.updatePlaylistDetails(playlistId, { description });
  }

  async addTracksToPlaylist(
    playlistId: string,
    trackUris: string[],
  ): Promise<void> {
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await this.fetchApi(`/playlists/${playlistId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ uris: batch }),
      });
    }
  }

  async removeTracksFromPlaylist(
    playlistId: string,
    trackUris: string[],
  ): Promise<void> {
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await this.fetchApi(`/playlists/${playlistId}/tracks`, {
        method: "DELETE",
        body: JSON.stringify({
          tracks: batch.map((uri) => ({ uri })),
        }),
      });
    }
  }

  async replacePlaylistTracks(
    playlistId: string,
    trackUris: string[],
  ): Promise<void> {
    const first = trackUris.slice(0, 100);
    await this.fetchApi(`/playlists/${playlistId}/tracks`, {
      method: "PUT",
      body: JSON.stringify({ uris: first }),
    });

    if (trackUris.length > 100) {
      await this.addTracksToPlaylist(playlistId, trackUris.slice(100));
    }
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.fetchApi(`/playlists/${playlistId}/followers`, {
      method: "DELETE",
    });
  }

  async createPlaylist(
    name: string,
    description?: string,
    isPublic: boolean = false,
  ): Promise<SpotifyPlaylist> {
    const me = (await this.fetchApi("/me")) as { id: string };

    const raw = (await this.fetchApi(`/users/${me.id}/playlists`, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description ?? "",
        public: isPublic,
      }),
    })) as Record<string, unknown>;

    return this.mapPlaylist(raw);
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  async searchTracks(query: string, limit: number = 5): Promise<SpotifyTrack[]> {
    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: String(limit),
    });

    const data = (await this.fetchApi(`/search?${params.toString()}`)) as {
      tracks: { items: Record<string, unknown>[] };
    };

    return data.tracks.items.map((item) => this.mapTrack(item));
  }

  // ---------------------------------------------------------------------------
  // Description helpers (delegates to utils/description.ts)
  // ---------------------------------------------------------------------------

  static composeDescription = composeDescription;
  static parseDescription = parseDescription;
}
