import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { PlaylistService } from "../../services/playlist-service.js";
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
