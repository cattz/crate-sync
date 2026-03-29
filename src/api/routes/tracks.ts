import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { tracks, matches, downloads, jobs, playlistTracks, playlists, rejections } from "../../db/schema.js";
import { eq, like, or, and, desc, sql, asc } from "drizzle-orm";

export const trackRoutes = new Hono();

// GET /api/tracks?q=search&limit=50&offset=0
trackRoutes.get("/", (c) => {
  const db = getDb();
  const q = c.req.query("q");
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
  const offset = Number(c.req.query("offset")) || 0;

  let query = db.select().from(tracks).$dynamic();

  if (q) {
    const pattern = `%${q}%`;
    query = query.where(
      or(like(tracks.title, pattern), like(tracks.artist, pattern), like(tracks.album, pattern)),
    );
  }

  const results = query.limit(limit).offset(offset).all();
  return c.json(results);
});

// GET /api/tracks/:id
trackRoutes.get("/:id", (c) => {
  const db = getDb();
  const track = db.select().from(tracks).where(eq(tracks.id, c.req.param("id"))).get();

  if (!track) {
    return c.json({ error: "Track not found" }, 404);
  }

  return c.json(track);
});

// GET /api/tracks/:id/rejections — rejection history for a track
trackRoutes.get("/:id/rejections", (c) => {
  const db = getDb();
  const trackId = c.req.param("id");
  const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get();

  if (!track) {
    return c.json({ error: "Track not found" }, 404);
  }

  const rows = db
    .select()
    .from(rejections)
    .where(eq(rejections.trackId, trackId))
    .orderBy(desc(rejections.createdAt))
    .all();

  return c.json(rows);
});

// GET /api/tracks/:id/lifecycle — full lifecycle for a track
trackRoutes.get("/:id/lifecycle", (c) => {
  const db = getDb();
  const trackId = c.req.param("id");
  const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get();

  if (!track) {
    return c.json({ error: "Track not found" }, 404);
  }

  // Playlists this track belongs to
  const memberOf = db
    .select({
      playlistId: playlistTracks.playlistId,
      position: playlistTracks.position,
      playlistName: playlists.name,
    })
    .from(playlistTracks)
    .innerJoin(playlists, eq(playlists.id, playlistTracks.playlistId))
    .where(eq(playlistTracks.trackId, trackId))
    .all();

  // All matches for this track (as source)
  const trackMatches = db
    .select()
    .from(matches)
    .where(and(eq(matches.sourceType, "spotify"), eq(matches.sourceId, trackId)))
    .all();

  // All downloads for this track
  const trackDownloads = db
    .select()
    .from(downloads)
    .where(eq(downloads.trackId, trackId))
    .orderBy(desc(downloads.createdAt))
    .all();

  // Related jobs (search/download jobs for this track)
  const trackJobs = db
    .select()
    .from(jobs)
    .where(sql`json_extract(${jobs.payload}, '$.trackId') = ${trackId}`)
    .orderBy(desc(jobs.createdAt))
    .all();

  return c.json({
    track,
    playlists: memberOf,
    matches: trackMatches,
    downloads: trackDownloads,
    jobs: trackJobs.map((j) => ({
      ...j,
      payload: j.payload ? JSON.parse(j.payload) : null,
      result: j.result ? JSON.parse(j.result) : null,
    })),
  });
});
