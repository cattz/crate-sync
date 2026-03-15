import { Hono } from "hono";
import { loadConfig, saveConfig, type Config } from "../../config.js";
import { checkHealth } from "../../utils/health.js";
import { getDb } from "../../db/client.js";
import { playlists, tracks, matches, downloads } from "../../db/schema.js";
import { sql } from "drizzle-orm";

export const statusRoutes = new Hono();

// GET /api/status
statusRoutes.get("/", async (c) => {
  const config = loadConfig();
  const health = await checkHealth(config);

  let dbStats = null;
  try {
    const db = getDb();
    const playlistCount = db.select({ count: sql<number>`count(*)` }).from(playlists).get();
    const trackCount = db.select({ count: sql<number>`count(*)` }).from(tracks).get();
    const matchCount = db.select({ count: sql<number>`count(*)` }).from(matches).get();
    const downloadCount = db.select({ count: sql<number>`count(*)` }).from(downloads).get();

    dbStats = {
      ok: true,
      playlists: playlistCount?.count ?? 0,
      tracks: trackCount?.count ?? 0,
      matches: matchCount?.count ?? 0,
      downloads: downloadCount?.count ?? 0,
    };
  } catch {
    dbStats = { ok: false, error: "Not available" };
  }

  return c.json({ ...health, database: dbStats });
});

// GET /api/config — return non-sensitive config
statusRoutes.get("/config", (c) => {
  const config = loadConfig();

  return c.json({
    lexicon: { url: config.lexicon.url, downloadRoot: config.lexicon.downloadRoot },
    soulseek: {
      slskdUrl: config.soulseek.slskdUrl,
      searchDelayMs: config.soulseek.searchDelayMs,
    },
    matching: config.matching,
    download: config.download,
  });
});

// PUT /api/config — update safe config values
statusRoutes.put("/config", async (c) => {
  const body = await c.req.json<Partial<Pick<Config, "matching" | "download">>>();
  const config = loadConfig();

  if (body.matching) {
    if (body.matching.autoAcceptThreshold != null) {
      config.matching.autoAcceptThreshold = body.matching.autoAcceptThreshold;
    }
    if (body.matching.reviewThreshold != null) {
      config.matching.reviewThreshold = body.matching.reviewThreshold;
    }
  }

  if (body.download) {
    if (body.download.formats != null) {
      config.download.formats = body.download.formats;
    }
    if (body.download.minBitrate != null) {
      config.download.minBitrate = body.download.minBitrate;
    }
    if (body.download.concurrency != null) {
      config.download.concurrency = body.download.concurrency;
    }
  }

  saveConfig(config);

  return c.json({ ok: true });
});
