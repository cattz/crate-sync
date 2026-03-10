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
}

export interface SoulseekConfig {
  slskdUrl: string;
  slskdApiKey: string;
  searchDelayMs: number;
}

export interface MatchingConfig {
  autoAcceptThreshold: number;
  reviewThreshold: number;
}

export interface DownloadConfig {
  formats: string[];
  minBitrate: number;
  concurrency: number;
}

export interface Config {
  spotify: SpotifyConfig;
  lexicon: LexiconConfig;
  soulseek: SoulseekConfig;
  matching: MatchingConfig;
  download: DownloadConfig;
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
  },
  soulseek: {
    slskdUrl: "http://localhost:5030",
    slskdApiKey: "",
    searchDelayMs: 5000,
  },
  matching: {
    autoAcceptThreshold: 0.9,
    reviewThreshold: 0.7,
  },
  download: {
    formats: ["flac", "mp3"],
    minBitrate: 320,
    concurrency: 3,
  },
};

export function getConfigPath(): string {
  return join(homedir(), ".config", "crate-sync", "config.json");
}

function mergeDefaults(
  partial: DeepPartial<Config>,
  base: Config,
): Config {
  return {
    spotify: { ...base.spotify, ...partial.spotify },
    lexicon: { ...base.lexicon, ...partial.lexicon },
    soulseek: { ...base.soulseek, ...partial.soulseek },
    matching: { ...base.matching, ...partial.matching },
    download: {
      ...base.download,
      ...partial.download,
      formats: partial.download?.formats?.filter((f): f is string => f != null) ?? base.download.formats,
    },
  };
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
