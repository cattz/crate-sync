import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { eq, sql } from "drizzle-orm";
import type { SpotifyConfig } from "../config.js";
import type { SpotifyPlaylist, SpotifyTrack } from "../types/spotify.js";
import { getDb } from "../db/client.js";
import { playlists, tracks, playlistTracks } from "../db/schema.js";
import { withRetry } from "../utils/retry.js";

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

export class SpotifyService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private refreshToken: string | null = null;
  private tokensLoaded = false;

  constructor(private config: SpotifyConfig) {}

  // ---------------------------------------------------------------------------
  // Token persistence
  // ---------------------------------------------------------------------------

  /** Load tokens from disk if available */
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

  /** Persist current tokens to disk */
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

  /** Get the OAuth authorization URL for the user to visit */
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

  /** Exchange an authorization code for access + refresh tokens */
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

  /** Check if we have valid (or refreshable) tokens */
  async isAuthenticated(): Promise<boolean> {
    this.loadTokens();

    // We have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return true;
    }

    // Try refreshing
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

  /** Set tokens directly (e.g. loaded from persistent storage) */
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

  /** Refresh the access token using the stored refresh token */
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
    // Spotify may issue a new refresh token
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }

    this.saveTokens();
  }

  /** Ensure we have a valid token, refreshing if expired */
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

  /** Fetch from the Spotify API with auth, rate-limit handling, and JSON parsing */
  private async fetchApi(
    path: string,
    options: RequestInit = {},
  ): Promise<unknown> {
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

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return this.fetchApi(path, options);
      }

      // Handle expired token — try refresh once
      if (response.status === 401) {
        await this.refreshAccessToken();
        return this.fetchApi(path, options);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "<no body>");
        throw new Error(
          `Spotify API error: ${response.status} ${response.statusText} — ${body}`,
        );
      }

      // 204 No Content
      if (response.status === 204) {
        return undefined;
      }

      return response.json();
    });
  }

  // ---------------------------------------------------------------------------
  // Response mappers
  // ---------------------------------------------------------------------------

  private mapPlaylist(raw: Record<string, unknown>): SpotifyPlaylist {
    const tracks = raw.tracks as Record<string, unknown> | undefined;
    return {
      id: String(raw.id),
      name: String(raw.name),
      description: raw.description ? String(raw.description) : undefined,
      snapshotId: String(raw.snapshot_id),
      trackCount: tracks ? Number(tracks.total) : 0,
      uri: String(raw.uri),
    };
  }

  private mapTrack(raw: Record<string, unknown>): SpotifyTrack {
    const artists = raw.artists as Array<Record<string, unknown>>;
    const album = raw.album as Record<string, unknown>;
    const externalIds = (raw.external_ids as Record<string, unknown>) ?? {};

    return {
      id: String(raw.id),
      title: String(raw.name),
      artist: artists.map((a) => String(a.name)).join(", "),
      artists: artists.map((a) => String(a.name)),
      album: String(album.name),
      durationMs: Number(raw.duration_ms),
      isrc: externalIds.isrc ? String(externalIds.isrc) : undefined,
      uri: String(raw.uri),
    };
  }

  // ---------------------------------------------------------------------------
  // Playlists — API
  // ---------------------------------------------------------------------------

  /** Get current user's playlists (handles pagination) */
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

  /** Get tracks for a playlist (handles pagination) */
  async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    const result: SpotifyTrack[] = [];
    let url: string | null = `/playlists/${playlistId}/tracks?limit=100`;

    while (url) {
      const data = (await this.fetchApi(url)) as {
        items: Array<{ track: Record<string, unknown> | null; added_at?: string }>;
        next: string | null;
      };

      for (const item of data.items) {
        // Skip deleted/unavailable tracks
        if (!item.track) continue;
        result.push(this.mapTrack(item.track));
      }

      url = data.next;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // DB sync
  // ---------------------------------------------------------------------------

  /**
   * Sync all playlists from Spotify to the local DB.
   * Upserts each playlist by spotify_id.
   */
  async syncToDb(): Promise<{ added: number; updated: number; unchanged: number }> {
    const db = getDb();
    const apiPlaylists = await this.getPlaylists();

    let added = 0;
    let updated = 0;
    let unchanged = 0;

    for (const pl of apiPlaylists) {
      const existing = await db
        .select()
        .from(playlists)
        .where(eq(playlists.spotifyId, pl.id))
        .get();

      if (!existing) {
        await db.insert(playlists).values({
          spotifyId: pl.id,
          name: pl.name,
          description: pl.description ?? null,
          snapshotId: pl.snapshotId,
          lastSynced: Date.now(),
        });
        added++;
      } else if (existing.snapshotId !== pl.snapshotId || existing.name !== pl.name) {
        await db
          .update(playlists)
          .set({
            name: pl.name,
            description: pl.description ?? null,
            snapshotId: pl.snapshotId,
            lastSynced: Date.now(),
          })
          .where(eq(playlists.spotifyId, pl.id));
        updated++;
      } else {
        unchanged++;
      }
    }

    return { added, updated, unchanged };
  }

  /**
   * Sync a single playlist's tracks from Spotify to the local DB.
   * Upserts each track by spotify_id, then syncs the playlist_tracks junction.
   */
  async syncPlaylistTracks(
    spotifyPlaylistId: string,
  ): Promise<{ added: number; updated: number }> {
    const db = getDb();

    // Resolve internal playlist ID
    const playlist = await db
      .select()
      .from(playlists)
      .where(eq(playlists.spotifyId, spotifyPlaylistId))
      .get();

    if (!playlist) {
      throw new Error(
        `Playlist with spotify_id "${spotifyPlaylistId}" not found in DB. Run syncToDb() first.`,
      );
    }

    const apiTracks = await this.getPlaylistTracks(spotifyPlaylistId);

    let added = 0;
    let updated = 0;

    for (let position = 0; position < apiTracks.length; position++) {
      const t = apiTracks[position];

      // Upsert track
      const existingTrack = await db
        .select()
        .from(tracks)
        .where(eq(tracks.spotifyId, t.id))
        .get();

      let trackId: string;

      if (!existingTrack) {
        const inserted = await db
          .insert(tracks)
          .values({
            spotifyId: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album,
            durationMs: t.durationMs,
            isrc: t.isrc ?? null,
            spotifyUri: t.uri,
          })
          .returning({ id: tracks.id })
          .get();
        trackId = inserted.id;
        added++;
      } else {
        // Update if metadata changed
        if (
          existingTrack.title !== t.title ||
          existingTrack.artist !== t.artist ||
          existingTrack.album !== t.album
        ) {
          await db
            .update(tracks)
            .set({
              title: t.title,
              artist: t.artist,
              album: t.album,
              durationMs: t.durationMs,
              isrc: t.isrc ?? null,
              spotifyUri: t.uri,
            })
            .where(eq(tracks.spotifyId, t.id));
          updated++;
        }
        trackId = existingTrack.id;
      }

      // Upsert playlist_tracks junction
      await db
        .insert(playlistTracks)
        .values({
          playlistId: playlist.id,
          trackId,
          position,
          addedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [playlistTracks.playlistId, playlistTracks.trackId],
          set: { position },
        });
    }

    // Remove tracks no longer in the playlist
    const apiTrackIds = new Set(apiTracks.map((t) => t.id));
    const currentJunctions = await db
      .select({
        id: playlistTracks.id,
        trackId: playlistTracks.trackId,
      })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlist.id))
      .all();

    // Collect internal track IDs that are still in the API response
    const apiInternalTrackIds = new Set<string>();
    for (const t of apiTracks) {
      const row = await db
        .select({ id: tracks.id })
        .from(tracks)
        .where(eq(tracks.spotifyId, t.id))
        .get();
      if (row) apiInternalTrackIds.add(row.id);
    }

    for (const junction of currentJunctions) {
      if (!apiInternalTrackIds.has(junction.trackId)) {
        await db
          .delete(playlistTracks)
          .where(eq(playlistTracks.id, junction.id));
      }
    }

    // Update playlist lastSynced
    await db
      .update(playlists)
      .set({ lastSynced: Date.now() })
      .where(eq(playlists.id, playlist.id));

    return { added, updated };
  }

  // ---------------------------------------------------------------------------
  // Playlist mutations — API
  // ---------------------------------------------------------------------------

  /** Rename a playlist */
  async renamePlaylist(playlistId: string, name: string): Promise<void> {
    await this.fetchApi(`/playlists/${playlistId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  }

  /** Add tracks to a playlist */
  async addTracksToPlaylist(
    playlistId: string,
    trackUris: string[],
  ): Promise<void> {
    // Spotify allows max 100 URIs per request
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await this.fetchApi(`/playlists/${playlistId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ uris: batch }),
      });
    }
  }

  /** Remove tracks from a playlist */
  async removeTracksFromPlaylist(
    playlistId: string,
    trackUris: string[],
  ): Promise<void> {
    // Spotify allows max 100 URIs per request
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

  /** Replace all tracks in a playlist */
  async replacePlaylistTracks(
    playlistId: string,
    trackUris: string[],
  ): Promise<void> {
    // First request replaces (max 100 URIs)
    const first = trackUris.slice(0, 100);
    await this.fetchApi(`/playlists/${playlistId}/tracks`, {
      method: "PUT",
      body: JSON.stringify({ uris: first }),
    });

    // Remaining tracks are appended in batches
    if (trackUris.length > 100) {
      await this.addTracksToPlaylist(playlistId, trackUris.slice(100));
    }
  }

  /** Delete (unfollow) a playlist */
  async deletePlaylist(playlistId: string): Promise<void> {
    await this.fetchApi(`/playlists/${playlistId}/followers`, {
      method: "DELETE",
    });
  }

  /** Create a new playlist */
  async createPlaylist(
    name: string,
    description?: string,
    isPublic: boolean = false,
  ): Promise<SpotifyPlaylist> {
    // Need current user ID first
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
}
