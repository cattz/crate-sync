---
# spec-03
title: Configuration module
status: completed
type: task
priority: critical
parent: spec-E0
depends_on: spec-01
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

# spec-03: Configuration module

## Purpose

Provide a centralized configuration system for crate-sync that loads settings from a JSON file at `~/.config/crate-sync/config.json`, deep-merges user-provided values with sensible defaults, expands tilde (`~`) in path values, and allows saving the merged config back to disk. This module is the single source of truth for all service URLs, credentials, matching thresholds, download preferences, Lexicon tag configuration, and job runner tuning.

## Public Interface

### File: `src/config.ts`

#### Config interfaces

```ts
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
}

export interface Config {
  spotify: SpotifyConfig;
  lexicon: LexiconConfig;
  soulseek: SoulseekConfig;
  matching: MatchingConfig;
  download: DownloadConfig;
  jobRunner: JobRunnerConfig;
}
```

#### Internal helper type

```ts
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
```

#### Exported functions

```ts
export function getConfigPath(): string;
export function loadConfig(): Config;
export function saveConfig(config: Config): void;
```

## Dependencies

- `node:fs` -- `readFileSync`, `writeFileSync`, `mkdirSync`, `existsSync`
- `node:path` -- `join`
- `node:os` -- `homedir`

No third-party dependencies.

## Behavior

### Default values

The module defines a complete `defaults` object that is used when no config file exists or when the config file omits fields:

```ts
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
  },
};
```

### `getConfigPath(): string`

Returns the absolute path to the config file: `<homedir>/.config/crate-sync/config.json`.

- Uses `os.homedir()` to resolve the home directory.
- Joins with `.config/crate-sync/config.json` using `path.join`.

### `loadConfig(): Config`

1. Calls `getConfigPath()` to determine the config file location.
2. If the file does **not** exist (`existsSync` returns false): returns a shallow copy of the `defaults` object (`{ ...defaults }`).
3. If the file **does** exist:
   a. Reads the file as UTF-8 (`readFileSync`).
   b. Parses it as JSON into a `DeepPartial<Config>`.
   c. Calls `mergeDefaults(partial, defaults)` to produce a complete `Config`.
4. Returns the merged `Config` object.

### `saveConfig(config: Config): void`

1. Calls `getConfigPath()` to determine the config file location.
2. Computes the parent directory (`join(configPath, "..")`).
3. If the parent directory does not exist, creates it recursively (`mkdirSync(dir, { recursive: true })`).
4. Serializes the config as pretty-printed JSON (`JSON.stringify(config, null, 2)`) with a trailing newline.
5. Writes the result to the config path as UTF-8.

### Deep merge behavior (`mergeDefaults`)

The internal `mergeDefaults(partial, base)` function performs a one-level-deep merge:

```ts
function mergeDefaults(partial: DeepPartial<Config>, base: Config): Config {
  const merged = {
    spotify: { ...base.spotify, ...partial.spotify },
    lexicon: {
      ...base.lexicon,
      ...partial.lexicon,
      tagCategory: {
        ...base.lexicon.tagCategory,
        ...partial.lexicon?.tagCategory,
      },
    },
    soulseek: { ...base.soulseek, ...partial.soulseek },
    matching: { ...base.matching, ...partial.matching },
    download: {
      ...base.download,
      ...partial.download,
      formats: partial.download?.formats?.filter((f): f is string => f != null) ?? base.download.formats,
      validationStrictness: partial.download?.validationStrictness ?? base.download.validationStrictness,
    },
    jobRunner: { ...base.jobRunner, ...(partial as any).jobRunner },
  };

  // Expand ~ in path-like config values
  merged.lexicon.downloadRoot = expandHome(merged.lexicon.downloadRoot);
  merged.soulseek.downloadDir = expandHome(merged.soulseek.downloadDir);

  return merged;
}
```

**Key merge rules:**

1. Each top-level section is spread: base first, then partial on top. This means any field in the user's config overrides the default for that section.
2. **`lexicon.tagCategory`** is a nested object -- it is merged separately so partial overrides (e.g., just the `name`) preserve the defaults for the other field (e.g., `color`).
3. **`download.formats`** gets special treatment: if the user provides a `formats` array, `null`/`undefined` entries are filtered out. If the user omits `formats` entirely, the default `["flac", "mp3"]` is used.
4. **`download.validationStrictness`** must be one of `"strict"`, `"moderate"`, or `"lenient"`. If not provided, defaults to `"moderate"`.
5. After merging, `expandHome()` is applied to `lexicon.downloadRoot` and `soulseek.downloadDir`.

### Tilde expansion (`expandHome`)

```ts
function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}
```

- If the path starts with `~/`, replaces `~` with `os.homedir()` and joins the remainder.
- If the path is exactly `~`, returns `os.homedir()`.
- Otherwise, returns the path unchanged.
- This is applied to `lexicon.downloadRoot` and `soulseek.downloadDir` after merge.

## Error Handling

| Scenario | Behavior |
|---|---|
| Config file does not exist | Returns default config (no error thrown) |
| Config file contains invalid JSON | `JSON.parse` throws a `SyntaxError` -- this propagates to the caller |
| Config file is not readable (permissions) | `readFileSync` throws -- propagates to the caller |
| Config directory cannot be created on save | `mkdirSync` throws -- propagates to the caller |
| Config file cannot be written on save | `writeFileSync` throws -- propagates to the caller |

The module does not catch or wrap any errors -- all filesystem and JSON parsing errors propagate directly.

## Tests

### Test: loadConfig returns defaults when no config file exists

```
Input:  Config file does not exist at ~/.config/crate-sync/config.json
Output: Config object matching the defaults exactly:
        - spotify.redirectUri === "http://127.0.0.1:8888/callback"
        - lexicon.url === "http://localhost:48624"
        - lexicon.tagCategory.name === "Spotify Playlists"
        - lexicon.tagCategory.color === "#1DB954"
        - soulseek.slskdUrl === "http://localhost:5030"
        - soulseek.searchDelayMs === 5000
        - matching.autoAcceptThreshold === 0.9
        - matching.reviewThreshold === 0.7
        - download.formats === ["flac", "mp3"]
        - download.minBitrate === 320
        - download.concurrency === 3
        - download.validationStrictness === "moderate"
        - jobRunner.pollIntervalMs === 1000
```

### Test: loadConfig merges partial config over defaults

```
Input:  Config file contains: { "spotify": { "clientId": "my-id" } }
Output: Config where:
        - spotify.clientId === "my-id"
        - spotify.clientSecret === "" (default)
        - spotify.redirectUri === "http://127.0.0.1:8888/callback" (default)
        - All other sections are defaults
```

### Test: loadConfig merges partial lexicon.tagCategory over defaults

```
Input:  Config file contains: { "lexicon": { "tagCategory": { "name": "My Tags" } } }
Output: Config where:
        - lexicon.tagCategory.name === "My Tags"
        - lexicon.tagCategory.color === "#1DB954" (default preserved)
```

### Test: loadConfig expands tilde in path fields

```
Input:  Config file contains: { "lexicon": { "downloadRoot": "~/Music/Lexicon" } }
Output: Config where:
        - lexicon.downloadRoot === "<homedir>/Music/Lexicon"
        (where <homedir> is the result of os.homedir())
```

### Test: loadConfig expands tilde in soulseek downloadDir

```
Input:  Config file contains: { "soulseek": { "downloadDir": "~/Downloads/slskd" } }
Output: Config where:
        - soulseek.downloadDir === "<homedir>/Downloads/slskd"
```

### Test: loadConfig does not expand tilde in non-path fields

```
Input:  Config file contains: { "soulseek": { "slskdUrl": "~not-a-path" } }
Output: Config where:
        - soulseek.slskdUrl === "~not-a-path" (unchanged -- expandHome only runs on downloadRoot and downloadDir)
```

### Test: loadConfig filters null values from formats array

```
Input:  Config file contains: { "download": { "formats": ["flac", null, "wav"] } }
Output: Config where:
        - download.formats === ["flac", "wav"] (null filtered out)
```

### Test: loadConfig uses default formats when formats not provided

```
Input:  Config file contains: { "download": { "minBitrate": 128 } }
Output: Config where:
        - download.formats === ["flac", "mp3"] (default)
        - download.minBitrate === 128 (overridden)
```

### Test: loadConfig uses provided validationStrictness

```
Input:  Config file contains: { "download": { "validationStrictness": "strict" } }
Output: Config where:
        - download.validationStrictness === "strict"
```

### Test: loadConfig defaults validationStrictness to "moderate"

```
Input:  Config file contains: { "download": { "minBitrate": 256 } }
Output: Config where:
        - download.validationStrictness === "moderate" (default)
```

### Test: saveConfig creates parent directory and writes JSON

```
Input:  Call saveConfig(config) where the directory does not exist
Output: - Directory ~/.config/crate-sync/ is created
        - File config.json is written with pretty-printed JSON + trailing newline
        - Content is parseable JSON matching the input config
```

### Test: getConfigPath returns expected path

```
Input:  Call getConfigPath()
Output: "<homedir>/.config/crate-sync/config.json"
```

### Test: loadConfig throws on invalid JSON

```
Input:  Config file contains: "{ not valid json"
Output: SyntaxError thrown
```

## Acceptance Criteria

- [ ] `SpotifyConfig` has fields: `clientId: string`, `clientSecret: string`, `redirectUri: string`
- [ ] `LexiconConfig` has fields: `url: string`, `downloadRoot: string`, `tagCategory: { name: string, color: string }`
- [ ] `SoulseekConfig` has fields: `slskdUrl: string`, `slskdApiKey: string`, `searchDelayMs: number`, `downloadDir: string`
- [ ] `MatchingConfig` has fields: `autoAcceptThreshold: number`, `reviewThreshold: number`
- [ ] `DownloadConfig` has fields: `formats: string[]`, `minBitrate: number`, `concurrency: number`, `validationStrictness: "strict" | "moderate" | "lenient"`
- [ ] `JobRunnerConfig` has field: `pollIntervalMs: number` (no `wishlistIntervalMs` -- wishlist is manual only)
- [ ] `Config` composes all six sub-configs: `spotify`, `lexicon`, `soulseek`, `matching`, `download`, `jobRunner`
- [ ] `lexicon.tagCategory` defaults to `{ name: "Spotify Playlists", color: "#1DB954" }`
- [ ] `download.validationStrictness` defaults to `"moderate"`
- [ ] `getConfigPath()` returns `~/.config/crate-sync/config.json` (with `~` expanded to actual homedir)
- [ ] `loadConfig()` returns full defaults when config file is missing
- [ ] `loadConfig()` deep-merges user config over defaults (one level per section, two levels for `lexicon.tagCategory`)
- [ ] `loadConfig()` expands `~` to homedir in `lexicon.downloadRoot` and `soulseek.downloadDir`
- [ ] `loadConfig()` filters `null` values from `download.formats`
- [ ] `saveConfig()` creates the parent directory recursively if it does not exist
- [ ] `saveConfig()` writes pretty-printed JSON with 2-space indent and trailing newline
- [ ] Invalid JSON in the config file causes a `SyntaxError` to propagate (no swallowing)
- [ ] All default values match the table in the Behavior section exactly
