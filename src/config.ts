import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface LexiconConfig {
  url: string;
  downloadRoot: string;
  tagCategory: {
    name: string;
    color: string;
  };
}

export interface SoulseekConfig {
  slskdUrl: string;
  slskdApiKey: string;
  searchDelayMs: number;
  /** Host path where slskd stores completed downloads (maps to slskd's /app/downloads). */
  downloadDir: string;
}

export interface MatchingConfig {
  autoAcceptThreshold: number;
  reviewThreshold: number;
}

export interface DownloadConfig {
  formats: string[];
  minBitrate: number;
  concurrency: number;
  validationStrictness: "strict" | "moderate" | "lenient";
}

export interface JobRunnerConfig {
  /** Polling interval in milliseconds. Default: 1000 */
  pollIntervalMs: number;
  /** Max concurrent jobs. Default: 3 */
  concurrency: number;
}

export interface Config {
  spotify: SpotifyConfig;
  lexicon: LexiconConfig;
  soulseek: SoulseekConfig;
  matching: MatchingConfig;
  download: DownloadConfig;
  jobRunner: JobRunnerConfig;
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const defaults: Config = {
  spotify: {
    clientId: "",
    clientSecret: "",
    redirectUri: "http://127.0.0.1:8888/callback",
  },
  lexicon: {
    url: "http://localhost:48624",
    downloadRoot: "",
    tagCategory: {
      name: "Spotify Playlists",
      color: "#1DB954",
    },
  },
  soulseek: {
    slskdUrl: "http://localhost:5030",
    slskdApiKey: "",
    searchDelayMs: 5000,
    downloadDir: "",
  },
  matching: {
    autoAcceptThreshold: 0.9,
    reviewThreshold: 0.7,
  },
  download: {
    formats: ["flac", "mp3"],
    minBitrate: 320,
    concurrency: 3,
    validationStrictness: "moderate",
  },
  jobRunner: {
    pollIntervalMs: 1000,
    concurrency: 3,
  },
};

export function getConfigPath(): string {
  return join(homedir(), ".config", "crate-sync", "config.json");
}

/** Expand leading ~ to the user's home directory. */
function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function mergeDefaults(
  partial: DeepPartial<Config>,
  base: Config,
): Config {
  const merged = {
    spotify: { ...base.spotify, ...partial.spotify },
    lexicon: {
      ...base.lexicon,
      ...partial.lexicon,
      tagCategory: { ...base.lexicon.tagCategory, ...partial.lexicon?.tagCategory },
    },
    soulseek: { ...base.soulseek, ...partial.soulseek },
    matching: { ...base.matching, ...partial.matching },
    download: {
      ...base.download,
      ...partial.download,
      formats: partial.download?.formats?.filter((f): f is string => f != null) ?? base.download.formats,
    },
    jobRunner: { ...base.jobRunner, ...(partial as any).jobRunner },
  };

  // Expand ~ in path-like config values
  merged.lexicon.downloadRoot = expandHome(merged.lexicon.downloadRoot);
  merged.soulseek.downloadDir = expandHome(merged.soulseek.downloadDir);

  return merged;
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return { ...defaults };
  }

  const raw = readFileSync(configPath, "utf-8");
  const partial: DeepPartial<Config> = JSON.parse(raw);

  return mergeDefaults(partial, defaults);
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const dir = join(configPath, "..");

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
