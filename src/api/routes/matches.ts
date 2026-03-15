import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { matches, tracks } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

export const matchRoutes = new Hono();

// GET /api/matches?status=pending&playlistId=xxx
matchRoutes.get("/", (c) => {
  const db = getDb();
  const status = c.req.query("status");

  let query = db.select().from(matches).$dynamic();

  if (status) {
    query = query.where(eq(matches.status, status as "pending" | "confirmed" | "rejected"));
  }

  const results = query.all();

  // Enrich with source track info
  const enriched = results.map((m) => {
    const sourceTrack =
      m.sourceType === "spotify"
        ? db.select().from(tracks).where(eq(tracks.id, m.sourceId)).get()
        : null;

    return { ...m, sourceTrack };
  });

  return c.json(enriched);
});

// PUT /api/matches/:id  { status: "confirmed" | "rejected" }
matchRoutes.put("/:id", async (c) => {
  const db = getDb();
  const body = await c.req.json<{ status: string }>();

  if (!["confirmed", "rejected"].includes(body.status)) {
    return c.json({ error: "Status must be 'confirmed' or 'rejected'" }, 400);
  }

  const existing = db.select().from(matches).where(eq(matches.id, c.req.param("id"))).get();
  if (!existing) {
    return c.json({ error: "Match not found" }, 404);
  }

  db.update(matches)
    .set({ status: body.status as "confirmed" | "rejected", updatedAt: Date.now() })
    .where(eq(matches.id, c.req.param("id")))
    .run();

  const updated = db.select().from(matches).where(eq(matches.id, c.req.param("id"))).get();
  return c.json(updated);
});
