import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { downloads, tracks } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";

export const downloadRoutes = new Hono();

// GET /api/downloads?status=pending&playlistId=xxx
downloadRoutes.get("/", (c) => {
  const db = getDb();
  const status = c.req.query("status");
  const playlistId = c.req.query("playlistId");

  let query = db.select().from(downloads).$dynamic();

  if (status) {
    query = query.where(
      eq(downloads.status, status as "pending" | "searching" | "downloading" | "validating" | "moving" | "done" | "failed"),
    );
  }

  if (playlistId) {
    query = query.where(eq(downloads.playlistId, playlistId));
  }

  const results = query.orderBy(desc(downloads.createdAt)).all();

  // Enrich with track info
  const enriched = results.map((d) => {
    const track = db.select().from(tracks).where(eq(tracks.id, d.trackId)).get();
    return { ...d, track };
  });

  return c.json(enriched);
});

// GET /api/downloads/:id
downloadRoutes.get("/:id", (c) => {
  const db = getDb();
  const download = db.select().from(downloads).where(eq(downloads.id, c.req.param("id"))).get();

  if (!download) {
    return c.json({ error: "Download not found" }, 404);
  }

  const track = db.select().from(tracks).where(eq(tracks.id, download.trackId)).get();
  return c.json({ ...download, track });
});
