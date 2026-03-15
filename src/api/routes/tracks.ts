import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { tracks } from "../../db/schema.js";
import { eq, like, or, sql } from "drizzle-orm";

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
