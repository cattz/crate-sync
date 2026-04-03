import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../../db/client.js";
import { downloads, tracks, playlists } from "../../db/schema.js";
import { eq, desc, inArray } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import { DownloadService } from "../../services/download-service.js";
import { createJob } from "../../jobs/runner.js";

export const downloadRoutes = new Hono();

// GET /api/downloads/recent — last 50 completed downloads with track + playlist info
downloadRoutes.get("/recent", (c) => {
  const db = getDb();

  const rows = db
    .select({
      id: downloads.id,
      trackTitle: tracks.title,
      trackArtist: tracks.artist,
      playlistName: playlists.name,
      filePath: downloads.filePath,
      completedAt: downloads.completedAt,
    })
    .from(downloads)
    .innerJoin(tracks, eq(downloads.trackId, tracks.id))
    .leftJoin(playlists, eq(downloads.playlistId, playlists.id))
    .where(eq(downloads.status, "done"))
    .orderBy(desc(downloads.completedAt))
    .limit(50)
    .all();

  return c.json(rows);
});

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

// DELETE /api/downloads?status=done|failed
downloadRoutes.delete("/", (c) => {
  const db = getDb();
  const status = c.req.query("status");

  const allowed = ["done", "failed"] as const;
  if (!status || !allowed.includes(status as (typeof allowed)[number])) {
    return c.json({ error: "Query param ?status must be 'done' or 'failed'" }, 400);
  }

  const ids = db
    .select({ id: downloads.id })
    .from(downloads)
    .where(eq(downloads.status, status as "done" | "failed"))
    .all()
    .map((r) => r.id);

  if (ids.length > 0) {
    db.delete(downloads).where(inArray(downloads.id, ids)).run();
  }

  return c.json({ deleted: ids.length });
});

// POST /api/downloads/clean-empty-dirs — remove empty subdirectories from slskd downloads
// (must be registered before /:id to avoid matching "clean-empty-dirs" as an id)
downloadRoutes.post("/clean-empty-dirs", (c) => {
  const db = getDb();
  const config = loadConfig();

  const svc = DownloadService.fromDb(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
    config.matching,
  );
  const removed = svc.cleanupEmptyDirs();

  return c.json({ removed });
});

// POST /api/downloads/rescue — trigger an orphan rescue scan
// (must be registered before /:id to avoid matching "rescue" as an id)
downloadRoutes.post("/rescue", (c) => {
  const job = createJob({
    type: "orphan_rescue",
    status: "queued",
    priority: 2,
  });

  return c.json({ ok: true, jobId: job.id });
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

// DELETE /api/downloads/:id/file — delete the physical file for a download
downloadRoutes.delete("/:id/file", (c) => {
  const db = getDb();
  const config = loadConfig();
  const download = db.select().from(downloads).where(eq(downloads.id, c.req.param("id"))).get();

  if (!download) {
    return c.json({ error: "Download not found" }, 404);
  }

  // Try to find the file: check soulseekPath first, then filePath
  const filePath = download.soulseekPath ?? download.filePath;
  if (!filePath) {
    return c.json({ deleted: false, reason: "No file path recorded" });
  }

  // Also check inside slskd download dir if path is relative
  const resolvedPath = filePath.startsWith("/")
    ? filePath
    : join(config.soulseek.downloadDir, filePath);

  if (!existsSync(resolvedPath)) {
    return c.json({ deleted: false, reason: "File not found on disk" });
  }

  const svc = DownloadService.fromDb(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
    config.matching,
  );
  const deleted = svc.deleteDownloadFile(resolvedPath);

  if (deleted) {
    // Clear the file path from the download record
    db.update(downloads)
      .set({ soulseekPath: null, filePath: null })
      .where(eq(downloads.id, download.id))
      .run();
  }

  return c.json({ deleted });
});
