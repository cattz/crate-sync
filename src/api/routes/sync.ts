import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import crypto from "node:crypto";
import { getDb } from "../../db/client.js";
import { PlaylistService } from "../../services/playlist-service.js";
import { loadConfig, type Config } from "../../config.js";
import { SyncPipeline } from "../../services/sync-pipeline.js";
import { syncState } from "../state.js";
import { createJob } from "../../jobs/runner.js";

export const syncRoutes = new Hono();

// POST /api/sync/track/:trackId — single track sync with Lexicon
// NOTE: must be registered before /:playlistId to avoid being shadowed
syncRoutes.post("/track/:trackId", async (c) => {
  const config = loadConfig();
  const pipeline = new SyncPipeline(config);

  try {
    const result = await pipeline.matchTrack(c.req.param("trackId"));
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }
});

// POST /api/sync/:playlistId — start sync via job queue, returns { syncId, jobId }
syncRoutes.post("/:playlistId", async (c) => {
  const db = getDb();
  const config = loadConfig();
  const svc = new PlaylistService(db);
  const playlist = svc.getPlaylist(c.req.param("playlistId"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  // Don't allow concurrent syncs for the same playlist
  for (const [, state] of syncState) {
    if (state.playlistId === playlist.id && state.status === "running") {
      return c.json({ error: "Sync already in progress for this playlist" }, 409);
    }
  }

  const syncId = crypto.randomUUID();
  syncState.set(syncId, {
    playlistId: playlist.id,
    status: "running",
    events: [],
    listeners: new Set(),
  });

  // Create the root job in the queue
  const job = createJob({
    type: "spotify_sync",
    status: "queued",
    priority: 10,
    payload: JSON.stringify({ playlistId: playlist.id, playlistName: playlist.name }),
  });

  // Also run via the in-process pipeline for SSE events
  runSync(syncId, playlist.id, config).catch((err) => {
    const state = syncState.get(syncId);
    if (state) {
      pushEvent(syncId, "error", { message: String(err) });
      state.status = "error";
    }
  });

  return c.json({ syncId, jobId: job.id });
});

// POST /api/sync/:playlistId/dry-run — match only (no tagging), returns JSON
syncRoutes.post("/:playlistId/dry-run", async (c) => {
  const config = loadConfig();
  const svc = new PlaylistService(getDb());
  const playlist = svc.getPlaylist(c.req.param("playlistId"));

  if (!playlist) {
    return c.json({ error: "Playlist not found" }, 404);
  }

  const pipeline = new SyncPipeline(config);
  const result = await pipeline.dryRun(playlist.id);

  return c.json(result);
});

// GET /api/sync/:syncId/events — SSE stream
syncRoutes.get("/:syncId/events", (c) => {
  const state = syncState.get(c.req.param("syncId"));

  if (!state) {
    return c.json({ error: "Sync session not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Send any buffered events first
    for (const event of state.events) {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
    }

    if (state.status !== "running") {
      return; // Already done, just replay
    }

    // Listen for new events
    const listener = async (event: { type: string; data: unknown }) => {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
    };

    state.listeners.add(listener);

    // Keep stream open until sync completes or client disconnects
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (state.status === "done" || state.status === "error") {
          clearInterval(check);
          state.listeners.delete(listener);
          resolve();
        }
      }, 500);

      stream.onAbort(() => {
        clearInterval(check);
        state.listeners.delete(listener);
        resolve();
      });
    });
  });
});

// GET /api/sync/:syncId — get sync status
syncRoutes.get("/:syncId", (c) => {
  const state = syncState.get(c.req.param("syncId"));

  if (!state) {
    return c.json({ error: "Sync session not found" }, 404);
  }

  return c.json({
    syncId: c.req.param("syncId"),
    playlistId: state.playlistId,
    status: state.status,
    eventCount: state.events.length,
  });
});

// --- Internal helpers ---

function pushEvent(syncId: string, type: string, data: unknown) {
  const state = syncState.get(syncId);
  if (!state) return;

  const event = { type, data };
  state.events.push(event);

  for (const listener of state.listeners) {
    listener(event).catch(() => {});
  }
}

async function runSync(syncId: string, playlistId: string, config: Config) {
  const pipeline = new SyncPipeline(config);

  pushEvent(syncId, "phase", { phase: "match" });

  const result = await pipeline.matchPlaylist(playlistId);

  pushEvent(syncId, "match-complete", {
    confirmed: result.confirmed.length,
    pending: result.pending.length,
    notFound: result.notFound.length,
    tagged: result.tagged,
  });

  // Sync returns immediately after match+tag — pending items go to review queue
  pushEvent(syncId, "phase", { phase: "done" });
  pushEvent(syncId, "sync-complete", {
    total: result.total,
    confirmed: result.confirmed.length,
    pending: result.pending.length,
    notFound: result.notFound.length,
    tagged: result.tagged,
  });

  const state = syncState.get(syncId);
  if (state) state.status = "done";
}
