import type { Config } from "../config.js";
import { SpotifyService } from "../services/spotify-service.js";
import { LexiconService } from "../services/lexicon-service.js";
import { SoulseekService } from "../services/soulseek-service.js";

export interface ServiceStatus {
  ok: boolean;
  error?: string;
}

export interface HealthStatus {
  spotify: ServiceStatus;
  lexicon: ServiceStatus;
  soulseek: ServiceStatus;
}

/** Check all external services and return their status. */
export async function checkHealth(config: Config): Promise<HealthStatus> {
  const [spotify, lexicon, soulseek] = await Promise.all([
    checkSpotify(config),
    checkLexicon(config),
    checkSoulseek(config),
  ]);

  return { spotify, lexicon, soulseek };
}

async function checkSpotify(config: Config): Promise<ServiceStatus> {
  try {
    if (!config.spotify.clientId || !config.spotify.clientSecret) {
      return { ok: false, error: "Missing client credentials" };
    }

    const service = new SpotifyService(config.spotify);
    const authenticated = await service.isAuthenticated();

    if (!authenticated) {
      return { ok: false, error: "Not authenticated (run `crate-sync auth login`)" };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function checkLexicon(config: Config): Promise<ServiceStatus> {
  try {
    if (!config.lexicon.url) {
      return { ok: false, error: "No URL configured" };
    }

    const service = new LexiconService(config.lexicon);
    const reachable = await service.ping();

    if (!reachable) {
      return { ok: false, error: `Not reachable (${config.lexicon.url})` };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function checkSoulseek(config: Config): Promise<ServiceStatus> {
  try {
    if (!config.soulseek.slskdApiKey) {
      return { ok: false, error: "Missing API key" };
    }

    const service = new SoulseekService(config.soulseek);
    const reachable = await service.ping();

    if (!reachable) {
      return { ok: false, error: `Not reachable (${config.soulseek.slskdUrl})` };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
