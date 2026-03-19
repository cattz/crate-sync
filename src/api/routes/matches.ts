import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { matches, tracks } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import { LexiconService } from "../../services/lexicon-service.js";

export const matchRoutes = new Hono();

// GET /api/matches?status=pending&playlistId=xxx
matchRoutes.get("/", async (c) => {
  const db = getDb();
  const status = c.req.query("status");

  let query = db.select().from(matches).$dynamic();

  if (status) {
    query = query.where(eq(matches.status, status as "pending" | "confirmed" | "rejected"));
  }

  const results = query.all();

  // Fetch Lexicon tracks once for target enrichment
  const lexiconTargetIds = new Set(
    results.filter((m) => m.targetType === "lexicon").map((m) => m.targetId),
  );

  let lexiconById = new Map<string, { id: string; title: string; artist: string; album?: string; durationMs?: number; filePath: string }>();

  if (lexiconTargetIds.size > 0) {
    try {
      const config = loadConfig();
      const lexicon = new LexiconService(config.lexicon);
      const allTracks = await lexicon.getTracks();
      for (const lt of allTracks) {
        if (lexiconTargetIds.has(lt.id)) {
          lexiconById.set(lt.id, lt);
        }
      }
    } catch {
      // Lexicon unavailable — enrich without target track info
    }
  }

  // Enrich with source track info and target track info
  const enriched = results.map((m) => {
    const sourceTrack =
      m.sourceType === "spotify"
        ? db.select().from(tracks).where(eq(tracks.id, m.sourceId)).get()
        : null;

    const targetTrack = lexiconById.get(m.targetId) ?? null;

    return { ...m, sourceTrack, targetTrack };
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
