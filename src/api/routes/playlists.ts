import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { getDb } from "../../db/client.js";
import { PlaylistService } from "../../services/playlist-service.js";
import { SpotifyService } from "../../services/spotify-service.js";
import { LexiconService } from "../../services/lexicon-service.js";
import { pushPlaylist } from "../../services/spotify-push.js";
import { playlists, playlistTracks, tracks, matches } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

export const playlistRoutes = new Hono();

function getService() {
  return PlaylistService.fromDb(getDb());
}

// ---- Literal routes (before any :id params) ----

// GET /api/playlists
playlistRoutes.get("/", (c) => {
  const svc = getService();
  const db = getDb();
  const all = svc.getPlaylists();

  // Enrich with track counts
  const enriched = all.map((p) => {
    const countRow = db
      .select({ count: sql<number>`count(*)` })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, p.id))
      .get();

    return { ...p, trackCount: countRow?.count ?? 0 };
  });

  return c.json(enriched);
});

// POST /api/playlists/sync — re-sync all playlists from Spotify
playlistRoutes.post("/sync", async (c) => {
  const config = loadConfig();

  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    return c.json({ error: "Spotify not configured" }, 400);
  }

  const spotify = new SpotifyService(config.spotify);
  const authenticated = await spotify.isAuthenticated();

  if (!authenticated) {
    return c.json({ error: "Spotify not authenticated" }, 401);
  }

  const database = getDb();
  const playlistService = PlaylistService.fromDb(database);

  const apiPlaylists = await spotify.getPlaylists();
  const currentUserId = await spotify.getCurrentUserId();
  const result = playlistService.syncPlaylistsFromApi(apiPlaylists, currentUserId);

  // Also sync tracks for each playlist
  const allPlaylists = database.select().from(playlists).all();
  const syncable = allPlaylists.filter((pl) => pl.spotifyId);

  let tracksSynced = 0;
  for (const pl of syncable) {
    try {
      const apiTracks = await spotify.getPlaylistTracks(pl.spotifyId!);
      const trackResult = playlistService.syncPlaylistTracksFromApi(pl.spotifyId!, apiTracks);
      tracksSynced += trackResult.added + trackResult.updated;
    } catch {
      // continue with other playlists
    }
  }

  return c.json({ ok: true, ...result, tracksSynced });
});

// POST /api/playlists/:id/pull — refresh a single playlist's tracks from Spotify
playlistRoutes.post("/:id/pull", async (c) => {
  const config = loadConfig();
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) return c.json({ error: "Playlist not found" }, 404);
  if (!playlist.spotifyId) return c.json({ error: "Playlist has no Spotify ID" }, 400);

  const spotify = new SpotifyService(config.spotify);
  const authenticated = await spotify.isAuthenticated();
  if (!authenticated) return c.json({ error: "Spotify not authenticated" }, 401);

  const apiTracks = await spotify.getPlaylistTracks(playlist.spotifyId);
  const result = svc.syncPlaylistTracksFromApi(playlist.spotifyId, apiTracks);
  return c.json({ ok: true, ...result });
});

// POST /api/playlists/bulk-rename
playlistRoutes.post("/bulk-rename", async (c) => {
  const svc = getService();
  const body = await c.req.json<{
    pattern: string;
    replacement: string;
    regex?: boolean;
    dryRun?: boolean;
    playlistIds?: string[];
  }>();

  const { pattern, replacement, regex, dryRun, playlistIds } = body;

  if (!pattern) {
    return c.json({ error: "pattern is required" }, 400);
  }

  const regexPattern = regex ? new RegExp(pattern) : pattern;
  const results = svc.bulkRename(regexPattern, replacement ?? "", { dryRun, playlistIds });

  return c.json(results);
});

// ---- :id/subpath routes (before bare :id) ----

// PUT /api/playlists/:id/rename
playlistRoutes.put("/:id/rename", async (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const { name } = await c.req.json<{ name: string }>();

  if (!name || !name.trim()) {
    return c.json({ error: "Name is required" }, 400);
  }

  svc.renamePlaylist(playlist.id, name.trim());
  return c.json({ ok: true });
});

// POST /api/playlists/:id/push — push local changes to Spotify
playlistRoutes.post("/:id/push", async (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  if (!playlist.spotifyId) {
    return c.json({ error: "Playlist has no Spotify ID" }, 400);
  }

  const config = loadConfig();
  const spotify = new SpotifyService(config.spotify);

  if (!(await spotify.isAuthenticated())) {
    return c.json({ error: "Spotify not authenticated" }, 401);
  }

  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({ dryRun: undefined }));
  const summary = await pushPlaylist(playlist.id, spotify, svc, {
    dryRun: body.dryRun,
  });

  return c.json(summary);
});

// POST /api/playlists/:id/lexicon — create Lexicon playlist from Spotify playlist
playlistRoutes.post("/:id/lexicon", async (c) => {
  const config = loadConfig();
  const svc = getService();
  const db = getDb();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) return c.json({ error: "Playlist not found" }, 404);

  // Get tracks in order (by position)
  const playlistTrackRows = svc.getPlaylistTracks(playlist.id);

  // For each track, look up confirmed Lexicon match
  const lexiconTrackIds: string[] = [];
  let skipped = 0;

  for (const track of playlistTrackRows) {
    const match = db
      .select({ targetId: matches.targetId })
      .from(matches)
      .where(
        and(
          eq(matches.sourceId, track.id),
          eq(matches.targetType, "lexicon"),
          eq(matches.status, "confirmed"),
        ),
      )
      .limit(1)
      .get();

    if (match) {
      lexiconTrackIds.push(match.targetId);
    } else {
      skipped++;
    }
  }

  if (lexiconTrackIds.length === 0) {
    return c.json({ error: "No tracks have confirmed Lexicon matches" }, 400);
  }

  // Create or update Lexicon playlist
  const lexicon = new LexiconService(config.lexicon);
  const existing = await lexicon.getPlaylistByName(playlist.name);

  if (existing) {
    await lexicon.setPlaylistTracks(existing.id, lexiconTrackIds);
  } else {
    const created = await lexicon.createPlaylist(playlist.name);
    await lexicon.setPlaylistTracks(created.id, lexiconTrackIds);
  }

  return c.json({
    ok: true,
    name: playlist.name,
    trackCount: lexiconTrackIds.length,
    skipped,
  });
});

// GET /api/playlists/:id/tracks
playlistRoutes.get("/:id/tracks", (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const enriched = c.req.query("enriched") !== "false"; // enriched by default
  const trackList = svc.getPlaylistTracks(playlist.id, { enriched });
  return c.json(trackList);
});

// ---- Bare :id routes (last) ----

// GET /api/playlists/:id
playlistRoutes.get("/:id", (c) => {
  const svc = getService();
  const db = getDb();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const statsRow = db
    .select({
      count: sql<number>`count(*)`,
      totalDurationMs: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
    })
    .from(playlistTracks)
    .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
    .where(eq(playlistTracks.playlistId, playlist.id))
    .get();

  return c.json({
    ...playlist,
    trackCount: statsRow?.count ?? 0,
    totalDurationMs: statsRow?.totalDurationMs ?? 0,
  });
});

// PATCH /api/playlists/:id — update metadata (tags, notes, pinned)
playlistRoutes.patch("/:id", async (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const body = await c.req.json<{ tags?: string[]; notes?: string; pinned?: boolean }>();
  const updates: Record<string, unknown> = {};

  if (body.tags !== undefined) {
    updates.tags = JSON.stringify(body.tags);
  }
  if (body.notes !== undefined) {
    updates.notes = body.notes;
  }
  if (body.pinned !== undefined) {
    updates.pinned = body.pinned ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ ok: true });
  }

  const db = getDb();
  db.update(playlists).set(updates).where(eq(playlists.id, playlist.id)).run();

  return c.json({ ok: true });
});

// DELETE /api/playlists/:id
playlistRoutes.delete("/:id", (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  svc.removePlaylist(playlist.id);
  return c.json({ ok: true });
});
