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
  /** Max time to wait for a download before marking it failed (default: 1800000 = 30min). */
  downloadTimeoutMs: number;
  /** How often the filesystem scanner checks for completed downloads (default: 15000 = 15s). */
  fileScanIntervalMs: number;
}

export interface MatchingWeights {
  title: number;
  artist: number;
  album: number;
  duration: number;
}

export interface MatchingConfig {
  autoAcceptThreshold: number;
  reviewThreshold: number;
  notFoundThreshold: number;
  lexiconWeights: MatchingWeights;
  soulseekWeights: MatchingWeights;
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  file: boolean;
}

export interface DownloadConfig {
  formats: string[];
  minBitrate: number;
  concurrency: number;
  validationStrictness: "strict" | "moderate" | "lenient";
}

export interface WishlistConfig {
  /** How often to retry wishlisted tracks, in hours. Default: 24 */
  retryIntervalHours: number;
  /** Max retry attempts before giving up. Default: 5 */
  maxRetries: number;
}

export interface JobRunnerConfig {
  /** Polling interval in milliseconds. Default: 1000 */
  pollIntervalMs: number;
  /** Max concurrent jobs. Default: 3 */
  concurrency: number;
  /** Auto-purge completed/failed jobs older than this many days. Default: 7 */
  retentionDays: number;
}

export interface LocalSourceConfig {
  path: string;
  structure: "letter-artist-album" | "artist-album" | "flat" | "year-playlist";
  formats: string[];
  fileOp: "copy" | "move";
}

export interface SourcesConfig {
  /** Ordered list of source IDs to try (e.g. ["local:lossless", "soulseek"]). */
  priority: string[];
  /** Named local filesystem sources. */
  local?: Record<string, LocalSourceConfig>;
}

export interface Config {
  spotify: SpotifyConfig;
  lexicon: LexiconConfig;
  soulseek: SoulseekConfig;
  matching: MatchingConfig;
  download: DownloadConfig;
  jobRunner: JobRunnerConfig;
  wishlist: WishlistConfig;
  logging: LoggingConfig;
  sources: SourcesConfig;
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
    downloadTimeoutMs: 1_800_000, // 30 minutes
    fileScanIntervalMs: 15_000,   // 15 seconds
  },
  matching: {
    autoAcceptThreshold: 0.9,
    reviewThreshold: 0.7,
    notFoundThreshold: 0.65,
    lexiconWeights: { title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 },
    soulseekWeights: { title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 },
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
    retentionDays: 7,
  },
  wishlist: {
    retryIntervalHours: 24,
    maxRetries: 5,
  },
  logging: {
    level: "info",
    file: true,
  },
  sources: {
    priority: ["soulseek"],
    local: {},
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
    matching: {
      ...base.matching,
      ...partial.matching,
      lexiconWeights: { ...base.matching.lexiconWeights, ...partial.matching?.lexiconWeights },
      soulseekWeights: { ...base.matching.soulseekWeights, ...partial.matching?.soulseekWeights },
    },
    download: {
      ...base.download,
      ...partial.download,
      formats: partial.download?.formats?.filter((f): f is string => f != null) ?? base.download.formats,
    },
    jobRunner: { ...base.jobRunner, ...(partial as any).jobRunner },
    wishlist: { ...base.wishlist, ...(partial as any).wishlist },
    logging: { ...base.logging, ...(partial as any).logging },
    sources: {
      priority: (partial as any).sources?.priority ?? base.sources.priority,
      local: { ...base.sources.local, ...(partial as any).sources?.local },
    },
  };

  // Expand ~ in path-like config values
  merged.lexicon.downloadRoot = expandHome(merged.lexicon.downloadRoot);
  merged.soulseek.downloadDir = expandHome(merged.soulseek.downloadDir);

  // Expand ~ in local source paths
  if (merged.sources.local) {
    for (const name of Object.keys(merged.sources.local)) {
      merged.sources.local[name] = {
        ...merged.sources.local[name],
        path: expandHome(merged.sources.local[name].path),
      };
    }
  }

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
