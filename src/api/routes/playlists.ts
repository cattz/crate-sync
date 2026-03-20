import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { getDb } from "../../db/client.js";
import { PlaylistService } from "../../services/playlist-service.js";
import { SpotifyService } from "../../services/spotify-service.js";
import { SyncPipeline } from "../../services/sync-pipeline.js";
import { playlists, playlistTracks, tracks } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";

export const playlistRoutes = new Hono();

function getService() {
  return new PlaylistService(getDb());
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

  const result = await spotify.syncToDb();
  return c.json({ ok: true, ...result });
});

// GET /api/playlists/duplicates — cross-playlist duplicates
playlistRoutes.get("/duplicates", (c) => {
  const svc = getService();
  const dupes = svc.findDuplicatesAcrossPlaylists();
  return c.json(dupes);
});

// GET /api/playlists/stats — library-wide statistics
playlistRoutes.get("/stats", (c) => {
  const svc = getService();
  const db = getDb();

  const totalPlaylists = svc.getPlaylists().length;

  const row = db
    .select({
      totalTracks: sql<number>`count(distinct ${playlistTracks.trackId})`,
      totalDurationMs: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
    })
    .from(playlistTracks)
    .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
    .get();

  return c.json({
    totalPlaylists,
    totalTracks: row?.totalTracks ?? 0,
    totalDurationMs: row?.totalDurationMs ?? 0,
  });
});

// POST /api/playlists/bulk-rename
playlistRoutes.post("/bulk-rename", async (c) => {
  const svc = getService();
  const body = await c.req.json<{
    mode: "find-replace" | "prefix" | "suffix";
    find?: string;
    replace?: string;
    value?: string;
    action?: "add" | "remove";
    dryRun: boolean;
    pushToSpotify?: boolean;
  }>();

  const { mode, find, replace, value, action, dryRun } = body;

  if (mode === "find-replace" && (!find || find.length === 0)) {
    return c.json({ error: "find is required for find-replace mode" }, 400);
  }

  if ((mode === "prefix" || mode === "suffix") && (!value || value.length === 0)) {
    return c.json({ error: "value is required for prefix/suffix mode" }, 400);
  }

  if ((mode === "prefix" || mode === "suffix") && !action) {
    return c.json({ error: "action (add/remove) is required for prefix/suffix mode" }, 400);
  }

  const all = svc.getPlaylists();
  const preview: Array<{ id: string; name: string; newName: string }> = [];

  for (const p of all) {
    let newName = p.name;

    if (mode === "find-replace") {
      newName = p.name.split(find!).join(replace ?? "");
    } else if (mode === "prefix") {
      if (action === "add") {
        newName = value! + p.name;
      } else {
        if (p.name.startsWith(value!)) {
          newName = p.name.slice(value!.length);
        }
      }
    } else if (mode === "suffix") {
      if (action === "add") {
        newName = p.name + value!;
      } else {
        if (p.name.endsWith(value!)) {
          newName = p.name.slice(0, -value!.length);
        }
      }
    }

    if (newName !== p.name) {
      preview.push({ id: p.id, name: p.name, newName });
    }
  }

  if (!dryRun) {
    for (const item of preview) {
      svc.renamePlaylist(item.id, item.newName);
    }
  }

  return c.json(preview);
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

  const spotifyTracks = await spotify.getPlaylistTracks(playlist.spotifyId);
  const diff = svc.getPlaylistDiff(playlist.id, spotifyTracks);

  // Check if name or description changed
  const spotifyPlaylists = await spotify.getPlaylists();
  const spotifyPlaylist = spotifyPlaylists.find((p) => p.id === playlist.spotifyId);
  const nameChanged = spotifyPlaylist ? spotifyPlaylist.name !== playlist.name : false;

  const localDescription = SpotifyService.composeDescription(playlist.notes ?? null, playlist.tags ?? null);
  const descriptionChanged = spotifyPlaylist ? (spotifyPlaylist.description ?? "") !== localDescription : false;

  const hasChanges = nameChanged || descriptionChanged || diff.toAdd.length > 0 || diff.toRemove.length > 0;

  if (!hasChanges) {
    return c.json({ ok: true, renamed: false, descriptionUpdated: false, added: 0, removed: 0, message: "No changes" });
  }

  // Push name and/or description if changed
  if (nameChanged || descriptionChanged) {
    const details: { name?: string; description?: string } = {};
    if (nameChanged) details.name = playlist.name;
    if (descriptionChanged) details.description = localDescription;
    await spotify.updatePlaylistDetails(playlist.spotifyId, details);
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
    descriptionUpdated: descriptionChanged,
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

// GET /api/playlists/:id/duplicates — within-playlist duplicates
playlistRoutes.get("/:id/duplicates", (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const dupes = svc.findDuplicatesInPlaylist(playlist.id);
  return c.json(dupes);
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
