import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { getDb } from "../../db/client.js";
import { PlaylistService } from "../../services/playlist-service.js";
import { SpotifyService } from "../../services/spotify-service.js";
import { SyncPipeline } from "../../services/sync-pipeline.js";
import { playlistTracks } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";

export const playlistRoutes = new Hono();

function getService() {
  return new PlaylistService(getDb());
}

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

  const result = await spotify.syncToDb();
  return c.json({ ok: true, ...result });
});

// GET /api/playlists/:id
playlistRoutes.get("/:id", (c) => {
  const svc = getService();
  const db = getDb();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlist.id))
    .get();

  return c.json({ ...playlist, trackCount: countRow?.count ?? 0 });
});

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

  const spotifyTracks = await spotify.getPlaylistTracks(playlist.spotifyId);
  const diff = svc.getPlaylistDiff(playlist.id, spotifyTracks);

  // Check if name changed
  const spotifyPlaylists = await spotify.getPlaylists();
  const spotifyPlaylist = spotifyPlaylists.find((p) => p.id === playlist.spotifyId);
  const nameChanged = spotifyPlaylist ? spotifyPlaylist.name !== playlist.name : false;

  const hasChanges = nameChanged || diff.toAdd.length > 0 || diff.toRemove.length > 0;

  if (!hasChanges) {
    return c.json({ ok: true, renamed: false, added: 0, removed: 0, message: "No changes" });
  }

  if (nameChanged) {
    await spotify.renamePlaylist(playlist.spotifyId, playlist.name);
  }

  if (diff.toRemove.length > 0) {
    await spotify.removeTracksFromPlaylist(playlist.spotifyId, diff.toRemove);
  }

  if (diff.toAdd.length > 0) {
    await spotify.addTracksToPlaylist(playlist.spotifyId, diff.toAdd);
  }

  // Refresh snapshot
  const updated = (await spotify.getPlaylists()).find((p) => p.id === playlist.spotifyId);
  if (updated) {
    svc.updateSnapshotId(playlist.id, updated.snapshotId);
  }

  return c.json({
    ok: true,
    renamed: nameChanged,
    added: diff.toAdd.length,
    removed: diff.toRemove.length,
  });
});

// POST /api/playlists/:id/repair — run match pipeline (Phase 1)
playlistRoutes.post("/:id/repair", async (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const config = loadConfig();
  const pipeline = new SyncPipeline(config);
  const result = await pipeline.matchPlaylist(playlist.id);

  return c.json({
    ok: true,
    playlistName: result.playlistName,
    total: result.total,
    found: result.found.length,
    needsReview: result.needsReview.length,
    notFound: result.notFound.length,
  });
});

// POST /api/playlists/:id/merge — merge tracks from source playlists into target
playlistRoutes.post("/:id/merge", async (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const { sourceIds } = await c.req.json<{ sourceIds: string[] }>();

  if (!sourceIds || sourceIds.length === 0) {
    return c.json({ error: "sourceIds is required" }, 400);
  }

  const result = svc.mergePlaylistTracks(playlist.id, sourceIds);
  return c.json({ ok: true, ...result });
});

// GET /api/playlists/:id/tracks
playlistRoutes.get("/:id/tracks", (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const tracks = svc.getPlaylistTracks(playlist.id);
  return c.json(tracks);
});
