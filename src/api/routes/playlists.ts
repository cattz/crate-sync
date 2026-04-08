import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { getDb } from "../../db/client.js";
import { PlaylistService } from "../../services/playlist-service.js";
import { SpotifyService } from "../../services/spotify-service.js";
import { LexiconService } from "../../services/lexicon-service.js";
import { pushPlaylist } from "../../services/spotify-push.js";
import { repairPlaylist, acceptRepair } from "../../services/repair-service.js";
import { parseM3U, parseCSV, parseTXT, type ImportFormat } from "../../services/playlist-import.js";
import { playlists, playlistTracks, tracks, matches } from "../../db/schema.js";
import { eq, and, sql, inArray } from "drizzle-orm";
import { emitJobEvent } from "../../jobs/runner.js";

export const playlistRoutes = new Hono();

function getService() {
  return PlaylistService.fromDb(getDb());
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

  const database = getDb();
  const playlistService = PlaylistService.fromDb(database);

  const apiPlaylists = await spotify.getPlaylists();
  const currentUserId = await spotify.getCurrentUserId();
  const result = playlistService.syncPlaylistsFromApi(apiPlaylists, currentUserId);

  // Also sync tracks for each playlist
  const allPlaylists = database.select().from(playlists).all();
  const syncable = allPlaylists.filter((pl) => pl.spotifyId);

  let tracksSynced = 0;
  emitJobEvent("spotify-sync", "job-started", "running", { playlistName: `Syncing ${syncable.length} playlists` }, "spotify_sync");

  for (let i = 0; i < syncable.length; i++) {
    const pl = syncable[i];
    try {
      emitJobEvent("spotify-sync", "job-started", "running", { playlistName: pl.name, progress: `${i + 1}/${syncable.length}` }, "spotify_sync");
      const apiTracks = await spotify.getPlaylistTracks(pl.spotifyId!);
      const trackResult = playlistService.syncPlaylistTracksFromApi(pl.spotifyId!, apiTracks);
      tracksSynced += trackResult.added + trackResult.updated;
    } catch {
      // continue with other playlists
    }
  }

  emitJobEvent("spotify-sync", "job-done", "done", { playlistName: `${syncable.length} playlists, ${tracksSynced} tracks synced` }, "spotify_sync");

  return c.json({ ok: true, ...result, tracksSynced });
});

// POST /api/playlists/:id/pull — refresh a single playlist's tracks from Spotify
playlistRoutes.post("/:id/pull", async (c) => {
  const config = loadConfig();
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) return c.json({ error: "Playlist not found" }, 404);
  if (!playlist.spotifyId) return c.json({ error: "Playlist has no Spotify ID" }, 400);

  const spotify = new SpotifyService(config.spotify);
  const authenticated = await spotify.isAuthenticated();
  if (!authenticated) return c.json({ error: "Spotify not authenticated" }, 401);

  try {
    emitJobEvent("spotify-pull", "job-started", "running", { playlistName: playlist.name }, "spotify_sync");
    const apiTracks = await spotify.getPlaylistTracks(playlist.spotifyId);
    const result = svc.syncPlaylistTracksFromApi(playlist.spotifyId, apiTracks);
    emitJobEvent("spotify-pull", "job-done", "done", { playlistName: playlist.name, ...result }, "spotify_sync");
    return c.json({ ok: true, added: result.added, updated: result.updated, removed: 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitJobEvent("spotify-pull", "job-failed", "failed", { playlistName: playlist.name, error: message }, "spotify_sync");
    return c.json({ error: message }, 500);
  }
});

// PUT /api/playlists/bulk-tags
playlistRoutes.put("/bulk-tags", async (c) => {
  const body = await c.req.json<{
    playlistIds: string[];
    addTags: string[];
    removeTags: string[];
  }>();

  const { playlistIds, addTags, removeTags } = body;

  if (!playlistIds?.length) {
    return c.json({ error: "playlistIds is required" }, 400);
  }
  if (!addTags?.length && !removeTags?.length) {
    return c.json({ error: "addTags or removeTags is required" }, 400);
  }

  const db = getDb();
  const rows = db
    .select({ id: playlists.id, tags: playlists.tags })
    .from(playlists)
    .where(inArray(playlists.id, playlistIds))
    .all();

  let updated = 0;
  for (const row of rows) {
    let current: string[] = [];
    try {
      current = row.tags ? JSON.parse(row.tags) : [];
    } catch {
      current = [];
    }

    const tagSet = new Set(current);
    for (const t of addTags ?? []) tagSet.add(t);
    for (const t of removeTags ?? []) tagSet.delete(t);

    const newTags = JSON.stringify([...tagSet].sort());
    if (newTags !== (row.tags ?? "[]")) {
      db.update(playlists)
        .set({ tags: newTags })
        .where(eq(playlists.id, row.id))
        .run();
      updated++;
    }
  }

  return c.json({ ok: true, updated });
});

// POST /api/playlists/merge
playlistRoutes.post("/merge", async (c) => {
  const svc = getService();
  const body = await c.req.json<{
    targetId: string;
    targetName?: string;
    sourceIds: string[];
    deleteSources?: boolean;
    dryRun?: boolean;
  }>();

  const { targetId, targetName, sourceIds, deleteSources, dryRun } = body;

  if (!targetId) {
    return c.json({ error: "targetId is required" }, 400);
  }
  if (!sourceIds?.length) {
    return c.json({ error: "sourceIds is required and must not be empty" }, 400);
  }

  // Resolve or create the target playlist
  let resolvedTargetId: string;
  if (targetId === "new") {
    if (dryRun) {
      return c.json({ error: "Cannot create a new playlist in dry-run mode" }, 400);
    }
    if (!targetName?.trim()) {
      return c.json({ error: "targetName is required when creating a new playlist" }, 400);
    }
    const newPlaylist = svc.createLocalPlaylist(targetName.trim());
    resolvedTargetId = newPlaylist.id;
  } else {
    const target = svc.getPlaylist(targetId);
    if (!target) {
      return c.json({ error: "Target playlist not found" }, 404);
    }
    resolvedTargetId = target.id;
  }

  // Validate source playlists
  for (const sid of sourceIds) {
    if (sid === resolvedTargetId) {
      return c.json({ error: "Cannot merge a playlist into itself" }, 400);
    }
    const source = svc.getPlaylist(sid);
    if (!source) {
      return c.json({ error: `Source playlist not found: ${sid}` }, 404);
    }
  }

  try {
    const result = svc.mergePlaylists(resolvedTargetId, sourceIds, { deleteSources, dryRun });

    return c.json({
      ok: true,
      targetId: resolvedTargetId,
      added: result.added,
      duplicates: result.duplicates,
      sourcesDeleted: result.sourcesDeleted,
      dryRun: !!dryRun,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// POST /api/playlists/bulk-rename
playlistRoutes.post("/bulk-rename", async (c) => {
  const svc = getService();
  const body = await c.req.json<{
    pattern: string;
    replacement: string;
    regex?: boolean;
    dryRun?: boolean;
    playlistIds?: string[];
  }>();

  const { pattern, replacement, regex, dryRun, playlistIds } = body;

  if (!pattern) {
    return c.json({ error: "pattern is required" }, 400);
  }

  const regexPattern = regex ? new RegExp(pattern) : pattern;
  const results = svc.bulkRename(regexPattern, replacement ?? "", { dryRun, playlistIds });

  return c.json(results);
});

// POST /api/playlists/import — import a playlist from file content
playlistRoutes.post("/import", async (c) => {
  const svc = getService();

  const body = await c.req.json<{
    name: string;
    content: string;
    format: ImportFormat;
  }>();

  const { name, content, format } = body;

  if (!name?.trim()) {
    return c.json({ error: "name is required" }, 400);
  }
  if (!content) {
    return c.json({ error: "content is required" }, 400);
  }
  if (!format || !["m3u", "csv", "txt"].includes(format)) {
    return c.json({ error: "format must be one of: m3u, csv, txt" }, 400);
  }

  const parsers: Record<ImportFormat, (c: string) => Array<{ title: string; artist: string; album?: string; durationMs?: number; isrc?: string }>> = {
    m3u: parseM3U,
    csv: parseCSV,
    txt: parseTXT,
  };

  const tracks = parsers[format](content);
  if (tracks.length === 0) {
    return c.json({ error: "No tracks could be parsed from the provided content" }, 400);
  }

  const result = svc.importTracks(name.trim(), tracks);

  return c.json({
    ok: true,
    playlistId: result.playlistId,
    added: result.added,
    duplicates: result.duplicates,
  });
});

// ---- :id/subpath routes (before bare :id) ----

// POST /api/playlists/:id/merge — merge sources into the playlist identified by :id
playlistRoutes.post("/:id/merge", async (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const body = await c.req.json<{
    sourceIds: string[];
    deleteSources?: boolean;
    dryRun?: boolean;
  }>();

  const { sourceIds, deleteSources, dryRun } = body;

  if (!sourceIds?.length) {
    return c.json({ error: "sourceIds is required and must not be empty" }, 400);
  }

  // Validate source playlists
  for (const sid of sourceIds) {
    if (sid === playlist.id) {
      return c.json({ error: "Cannot merge a playlist into itself" }, 400);
    }
    const source = svc.getPlaylist(sid);
    if (!source) {
      return c.json({ error: `Source playlist not found: ${sid}` }, 404);
    }
  }

  try {
    const result = svc.mergePlaylists(playlist.id, sourceIds, { deleteSources, dryRun });

    return c.json({
      ok: true,
      targetId: playlist.id,
      added: result.added,
      duplicates: result.duplicates,
      sourcesDeleted: result.sourcesDeleted,
      dryRun: !!dryRun,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// POST /api/playlists/:id/dedup — find and remove duplicate tracks
playlistRoutes.post("/:id/dedup", async (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({}));
  const result = svc.removeDuplicates(playlist.id, { dryRun: body.dryRun });

  return c.json({
    ok: true,
    playlistId: playlist.id,
    dryRun: !!body.dryRun,
    removed: result.removed,
    groups: result.groups.map((g) => ({
      kept: { id: g.kept.id, title: g.kept.title, artist: g.kept.artist, position: g.kept.position },
      duplicates: g.duplicates.map((d) => ({ id: d.id, title: d.title, artist: d.artist, position: d.position })),
      reason: g.reason,
    })),
  });
});

// POST /api/playlists/:id/repair — repair broken/local tracks
playlistRoutes.post("/:id/repair", async (c) => {
  const config = loadConfig();
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) return c.json({ error: "Playlist not found" }, 404);
  if (!playlist.spotifyId) return c.json({ error: "Playlist has no Spotify ID" }, 400);

  const spotify = new SpotifyService(config.spotify);
  if (!(await spotify.isAuthenticated())) {
    return c.json({ error: "Spotify not authenticated" }, 401);
  }

  try {
    const report = await repairPlaylist(playlist.id, svc, spotify);
    return c.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// POST /api/playlists/:id/repair/accept — accept a repair
playlistRoutes.post("/:id/repair/accept", async (c) => {
  const config = loadConfig();
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) return c.json({ error: "Playlist not found" }, 404);

  const body = await c.req.json<{ repairedSpotifyId: string }>();
  if (!body.repairedSpotifyId) {
    return c.json({ error: "repairedSpotifyId is required" }, 400);
  }

  const spotify = new SpotifyService(config.spotify);
  if (!(await spotify.isAuthenticated())) {
    return c.json({ error: "Spotify not authenticated" }, 401);
  }

  try {
    await acceptRepair(playlist.id, body.repairedSpotifyId, svc, spotify);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
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

  const body = await c.req.json<{ dryRun?: boolean; confirmed?: boolean }>().catch(() => ({}));
  const summary = await pushPlaylist(playlist.id, spotify, svc, {
    dryRun: body.dryRun,
    confirmed: body.confirmed,
  });

  return c.json(summary);
});

// POST /api/playlists/:id/lexicon — create Lexicon playlist from Spotify playlist
playlistRoutes.post("/:id/lexicon", async (c) => {
  const config = loadConfig();
  const svc = getService();
  const db = getDb();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) return c.json({ error: "Playlist not found" }, 404);

  // Get tracks in order (by position)
  const playlistTrackRows = svc.getPlaylistTracks(playlist.id);

  // For each track, look up confirmed Lexicon match
  const lexiconTrackIds: string[] = [];
  let skipped = 0;

  for (const track of playlistTrackRows) {
    const match = db
      .select({ targetId: matches.targetId })
      .from(matches)
      .where(
        and(
          eq(matches.sourceId, track.id),
          eq(matches.targetType, "lexicon"),
          eq(matches.status, "confirmed"),
        ),
      )
      .limit(1)
      .get();

    if (match) {
      lexiconTrackIds.push(match.targetId);
    } else {
      skipped++;
    }
  }

  if (lexiconTrackIds.length === 0) {
    return c.json({ error: "No tracks have confirmed Lexicon matches" }, 400);
  }

  // Create or update Lexicon playlist
  const lexicon = new LexiconService(config.lexicon);
  const existing = await lexicon.getPlaylistByName(playlist.name);

  if (existing) {
    await lexicon.setPlaylistTracks(existing.id, lexiconTrackIds);
  } else {
    const created = await lexicon.createPlaylist(playlist.name);
    await lexicon.setPlaylistTracks(created.id, lexiconTrackIds);
  }

  return c.json({
    ok: true,
    name: playlist.name,
    trackCount: lexiconTrackIds.length,
    skipped,
  });
});

// GET /api/playlists/:id/tracks
playlistRoutes.get("/:id/tracks", (c) => {
  const svc = getService();
  const playlist = svc.getPlaylist(c.req.param("id"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const enriched = c.req.query("enriched") !== "false"; // enriched by default
  const trackList = svc.getPlaylistTracks(playlist.id, { enriched });
  return c.json(trackList);
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
