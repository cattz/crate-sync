import { Hono } from "hono";
import { loadConfig, saveConfig, type Config } from "../../config.js";
import { checkHealth } from "../../utils/health.js";
import { SpotifyService } from "../../services/spotify-service.js";
import { waitForAuthCallback } from "../../services/spotify-auth-server.js";
import { SoulseekService } from "../../services/soulseek-service.js";
import { isSignalRConnected } from "../../jobs/runner.js";
import { getDb } from "../../db/client.js";
import { playlists, tracks, matches, downloads } from "../../db/schema.js";
import { sql } from "drizzle-orm";

// Track in-flight Spotify OAuth flow
let pendingSpotifyAuth: { spotify: SpotifyService; promise: Promise<void> } | null = null;

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

  return c.json({
    ...health,
    soulseek: { ...health.soulseek, signalr: isSignalRConnected() },
    database: dbStats,
  });
});

// GET /api/config — return non-sensitive config
statusRoutes.get("/config", (c) => {
  const config = loadConfig();

  return c.json({
    lexicon: { url: config.lexicon.url, downloadRoot: config.lexicon.downloadRoot },
    soulseek: {
      slskdUrl: config.soulseek.slskdUrl,
      searchDelayMs: config.soulseek.searchDelayMs,
      downloadTimeoutMs: config.soulseek.downloadTimeoutMs,
    },
    matching: config.matching,
    download: config.download,
    jobRunner: config.jobRunner,
    logging: config.logging,
  });
});

// PUT /api/config — update safe config values
statusRoutes.put("/config", async (c) => {
  const body = await c.req.json<Partial<Pick<Config, "matching" | "download" | "jobRunner" | "soulseek" | "logging">>>();
  const config = loadConfig();

  if (body.matching) {
    if (body.matching.autoAcceptThreshold != null) {
      config.matching.autoAcceptThreshold = body.matching.autoAcceptThreshold;
    }
    if (body.matching.reviewThreshold != null) {
      config.matching.reviewThreshold = body.matching.reviewThreshold;
    }
    if (body.matching.notFoundThreshold != null) {
      config.matching.notFoundThreshold = body.matching.notFoundThreshold;
    }
    if (body.matching.lexiconWeights) {
      config.matching.lexiconWeights = { ...config.matching.lexiconWeights, ...body.matching.lexiconWeights };
    }
    if (body.matching.soulseekWeights) {
      config.matching.soulseekWeights = { ...config.matching.soulseekWeights, ...body.matching.soulseekWeights };
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
    if (body.download.validationStrictness != null) {
      config.download.validationStrictness = body.download.validationStrictness as Config["download"]["validationStrictness"];
    }
  }

  if (body.jobRunner) {
    if (body.jobRunner.concurrency != null) {
      config.jobRunner.concurrency = body.jobRunner.concurrency;
    }
    if (body.jobRunner.retentionDays != null) {
      config.jobRunner.retentionDays = body.jobRunner.retentionDays;
    }
  }

  if (body.soulseek) {
    if (body.soulseek.downloadTimeoutMs != null) {
      config.soulseek.downloadTimeoutMs = body.soulseek.downloadTimeoutMs;
    }
  }

  if (body.logging) {
    if (body.logging.level != null) {
      config.logging.level = body.logging.level;
    }
    if (body.logging.file != null) {
      config.logging.file = body.logging.file;
    }
  }

  saveConfig(config);

  return c.json({ ok: true });
});

// POST /api/spotify/login — start Spotify OAuth flow
statusRoutes.post("/spotify/login", async (c) => {
  const config = loadConfig();

  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    return c.json({ ok: false, error: "Missing Spotify client credentials in config" }, 400);
  }

  const spotify = new SpotifyService(config.spotify);
  const state = Math.random().toString(36).slice(2);

  const redirectUrl = new URL(config.spotify.redirectUri);
  const port = parseInt(redirectUrl.port, 10) || 8888;

  const authUrl = spotify.getAuthUrl(state);

  // Start callback server and exchange code in background
  const promise = waitForAuthCallback(port).then(async (code) => {
    await spotify.exchangeCode(code);
  });

  pendingSpotifyAuth = { spotify, promise };

  // Don't await — the user needs to visit the URL first
  promise.then(() => { pendingSpotifyAuth = null; }).catch(() => { pendingSpotifyAuth = null; });

  return c.json({ ok: true, authUrl });
});

// GET /api/spotify/auth-status — check if OAuth flow completed
statusRoutes.get("/spotify/auth-status", async (c) => {
  const config = loadConfig();
  const spotify = new SpotifyService(config.spotify);
  const authenticated = await spotify.isAuthenticated();
  return c.json({ authenticated, pending: pendingSpotifyAuth !== null });
});

// DELETE /api/spotify/login — clear Spotify tokens
statusRoutes.delete("/spotify/login", async (c) => {
  const { existsSync, unlinkSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

  const tokenPath = join(homedir(), ".config", "crate-sync", "spotify-tokens.json");
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath);
  }

  return c.json({ ok: true });
});

// PUT /api/soulseek/connect — save slskd credentials and test connection
statusRoutes.put("/soulseek/connect", async (c) => {
  const body = await c.req.json<{ slskdUrl?: string; slskdApiKey?: string }>();
  const config = loadConfig();

  if (body.slskdUrl != null) {
    config.soulseek.slskdUrl = body.slskdUrl;
  }
  if (body.slskdApiKey != null) {
    config.soulseek.slskdApiKey = body.slskdApiKey;
  }

  if (!config.soulseek.slskdApiKey) {
    return c.json({ ok: false, error: "API key is required" }, 400);
  }

  // Test connection before saving
  const service = new SoulseekService(config.soulseek);
  const reachable = await service.ping();

  if (!reachable) {
    return c.json({ ok: false, error: `Cannot reach slskd at ${config.soulseek.slskdUrl}` }, 400);
  }

  saveConfig(config);
  return c.json({ ok: true });
});

// DELETE /api/soulseek/connect — clear slskd credentials
statusRoutes.delete("/soulseek/connect", async (c) => {
  const config = loadConfig();
  config.soulseek.slskdApiKey = "";
  saveConfig(config);
  return c.json({ ok: true });
});
