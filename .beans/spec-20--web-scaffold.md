---
# spec-20
title: Web scaffold, API client, layout
status: todo
type: task
priority: high
parent: spec-E5
depends_on: spec-17
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

# Web Scaffold, API Client, Layout

## Purpose

Define the web application scaffold: package configuration, build tooling, React root setup, application layout (sidebar + content), the complete CSS design system, the API client with all methods and TypeScript types, React Query hooks with cache invalidation patterns, and route definitions.

---

## Public Interface

### Package Configuration (`web/package.json`)

```json
{
  "name": "crate-sync-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

**Dependencies:**
| Package                | Version  |
|------------------------|----------|
| `react`               | `^19.1.0` |
| `react-dom`           | `^19.1.0` |
| `react-router`        | `^7.6.1`  |
| `@tanstack/react-query` | `^5.80.7` |

**Dev Dependencies:**
| Package                | Version  |
|------------------------|----------|
| `@types/react`         | `^19.1.6` |
| `@types/react-dom`     | `^19.1.6` |
| `@vitejs/plugin-react` | `^4.5.2`  |
| `typescript`           | `^5.8.3`  |
| `vite`                 | `^6.3.5`  |

**pnpm config:** `"onlyBuiltDependencies": ["esbuild"]`.

### TypeScript Configuration (`web/tsconfig.json`)

| Option                       | Value                                  |
|------------------------------|----------------------------------------|
| `target`                     | `"ES2022"`                             |
| `lib`                        | `["ES2022", "DOM", "DOM.Iterable"]`    |
| `module`                     | `"ESNext"`                             |
| `moduleResolution`           | `"bundler"`                            |
| `jsx`                        | `"react-jsx"`                          |
| `strict`                     | `true`                                 |
| `noEmit`                     | `true`                                 |
| `skipLibCheck`               | `true`                                 |
| `isolatedModules`            | `true`                                 |
| `esModuleInterop`            | `true`                                 |
| `resolveJsonModule`          | `true`                                 |
| `allowImportingTsExtensions` | `true`                                 |
| `include`                    | `["src"]`                              |

### Vite Configuration (`web/vite.config.ts`)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});
```

- Dev server on port `5173`.
- All `/api` requests proxied to the backend at `http://localhost:3100`.
- Uses `@vitejs/plugin-react` for JSX transform and fast refresh.
- No custom build output directory specified (uses Vite default `dist/`).

---

## Behavior

### React Root Setup (`web/src/main.tsx`)

1. Creates a `QueryClient` with `defaultOptions.queries.staleTime = 30_000` (30 seconds).
2. Renders into `document.getElementById("root")!` via `createRoot`.
3. Wraps the app in: `StrictMode` > `QueryClientProvider` > `BrowserRouter` > `Routes`.
4. Imports `./styles/globals.css` for the design system.

### Route Definitions

| Path               | Component        | Notes                        |
|--------------------|------------------|------------------------------|
| `/` (index)        | `Dashboard`      | Default landing page         |
| `/playlists`       | `Playlists`      | Playlist listing             |
| `/playlists/:id`   | `PlaylistDetail`  | Single playlist detail       |
| `/matches`         | `Matches`        | Match registry browser       |
| `/downloads`       | `Downloads`      | Download status browser      |
| `/queue`           | `Queue`          | Job queue browser            |
| `/queue/:id`       | `JobDetail`      | Single job detail            |
| `/review`          | `Review`         | Pending match review page    |
| `/tracks/:id`      | `TrackDetail`    | Single track lifecycle page  |
| `/settings`        | `Settings`       | Configuration editor         |

All routes are nested inside `<Route element={<App />}>` which provides the shell layout via `<Outlet />`.

### App Layout (`web/src/App.tsx`)

The `App` component renders a two-panel layout:

- **Sidebar** (`.sidebar`, 180px fixed width, left side):
  - `<h1>Crate Sync</h1>` header.
  - `<nav>` with `NavLink` items, each with an `isActive` prop that adds `"active"` class:
    - Dashboard (`/`, with `end` prop)
    - Playlists (`/playlists`)
    - Review (`/review`)
    - Matches (`/matches`)
    - Downloads (`/downloads`)
    - Queue (`/queue`)
    - Settings (`/settings`)
  - **Service status indicators** at bottom (pushed down with `marginTop: "auto"`): shows `StatusDot` (8px colored circles: green `#1db954` for ok, red `#e74c3c` for error) for Spotify, Lexicon, Soulseek, Database. Data from `useStatus()` hook.

- **Content area** (`.content`, `margin-left: 180px`):
  - Renders `<Outlet />` for the matched route component.

---

## CSS Design System (`web/src/styles/globals.css`)

### Custom Properties

| Property        | Value                                                      |
|-----------------|------------------------------------------------------------|
| `--bg`          | `#0f0f0f`                                                  |
| `--bg-card`     | `#1a1a1a`                                                  |
| `--bg-hover`    | `#252525`                                                  |
| `--border`      | `#2a2a2a`                                                  |
| `--text`        | `#e0e0e0`                                                  |
| `--text-muted`  | `#888`                                                     |
| `--accent`      | `#1db954` (Spotify green)                                  |
| `--accent-hover`| `#1ed760`                                                  |
| `--danger`      | `#e74c3c`                                                  |
| `--warning`     | `#f39c12`                                                  |
| `--info`        | `#3498db`                                                  |
| `--radius`      | `8px`                                                      |
| `--font`        | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `--font-mono`   | `"SF Mono", "Fira Code", monospace`                        |

### Global Reset

- `* { margin: 0; padding: 0; box-sizing: border-box; }`
- `body`: font-family var(--font), bg var(--bg), color var(--text), line-height 1.4, font-size 14px.
- `a`: color var(--accent), no underline; hover var(--accent-hover).

### Layout Classes

| Class      | Styles                                                                  |
|------------|-------------------------------------------------------------------------|
| `.app`     | `display: flex; min-height: 100vh`                                       |
| `.sidebar` | `width: 180px; background: var(--bg-card); border-right: 1px solid var(--border); padding: 1rem 0; position: fixed; top: 0; bottom: 0; overflow-y: auto` |
| `.content` | `margin-left: 180px; flex: 1; padding: 1.25rem 1.5rem`                  |

### Sidebar Styles

- `.sidebar h1`: font-size 1rem, padding 0 1rem 0.75rem, border-bottom.
- `.sidebar nav a`: display block, padding 0.35rem 1rem, color var(--text-muted), font-size 0.85rem, transition on background + color.
- `.sidebar nav a:hover, .sidebar nav a.active`: background var(--bg-hover), color var(--text).

### Component Classes

**Card:**
- `.card`: bg var(--bg-card), border 1px solid var(--border), border-radius var(--radius), padding 0.75rem 1rem, margin-bottom 0.75rem.

**Table:**
- `table`: width 100%, border-collapse collapse.
- `th, td`: text-align left, padding 0.35rem 0.6rem, border-bottom 1px solid var(--border), white-space nowrap.
- `th`: color var(--text-muted), font-weight 500, font-size 0.8rem, text-transform uppercase, letter-spacing 0.05em.
- `tr:hover td`: background var(--bg-hover).
- `td.wrap`: white-space normal, max-width 400px, overflow hidden, text-overflow ellipsis.

**Badge Variants:**
| Class         | Background                        | Color     |
|---------------|-----------------------------------|-----------|
| `.badge`      | padding 0.1rem 0.4rem, border-radius 3px, font-size 0.7rem, font-weight 500 |           |
| `.badge-green`| `rgba(29, 185, 84, 0.15)`        | `#1db954` |
| `.badge-yellow`| `rgba(243, 156, 18, 0.15)`      | `#f39c12` |
| `.badge-red`  | `rgba(231, 76, 60, 0.15)`        | `#e74c3c` |
| `.badge-blue` | `rgba(52, 152, 219, 0.15)`       | `#3498db` |
| `.badge-gray` | `rgba(136, 136, 136, 0.15)`      | `#888`    |

**Stat Card:**
- `.grid-stats`: flex, flex-wrap, gap 0.6rem, margin-bottom 1rem.
- `.stat-card`: bg var(--bg-card), border, border-radius, padding 0.5rem 0.85rem, flex row, align-items baseline, gap 0.5rem.
- `.stat-card .label`: muted, 0.75rem, uppercase, letter-spacing.
- `.stat-card .value`: 1.25rem, font-weight 700.

**Buttons:**
- Default `button`: font var(--font), 0.8rem, padding 0.3rem 0.7rem, border-radius 5px, border 1px solid var(--border), bg var(--bg-card), color var(--text), cursor pointer, transition.
- `button:hover`: bg var(--bg-hover).
- `button.primary`: bg var(--accent), border-color var(--accent), color #000, font-weight 600. Hover: bg var(--accent-hover).
- `button.danger`: border-color var(--danger), color var(--danger). Hover: bg rgba(231,76,60,0.1).
- `button:disabled`: opacity 0.5, cursor not-allowed.

**Forms:**
- `input, select, textarea`: font var(--font), 0.8rem, padding 0.3rem 0.6rem, border-radius 5px, border 1px solid var(--border), bg var(--bg), color var(--text).
- Focus: outline none, border-color var(--accent).

**Modal:**
- `.modal-overlay`: position fixed, inset 0, bg rgba(0,0,0,0.6), flex center, z-index 100.
- `.modal`: min-width 340px, max-width 460px.

**Bulk Toolbar:**
- `.bulk-toolbar`: position fixed, bottom 1.5rem, left 50%, transform translateX(-50%), bg var(--bg-card), border, border-radius, padding 0.5rem 1rem, flex row, align-items center, gap 0.5rem, z-index 50, box-shadow 0 4px 12px rgba(0,0,0,0.3).

**Progress Bar:**
- `.progress-bar`: height 6px, bg var(--border), border-radius 3px, overflow hidden.
- `.progress-bar .fill`: height 100%, bg var(--accent), transition width 0.3s.

**Inline Track:**
- `.inline-track`: overflow hidden, text-overflow ellipsis, white-space nowrap, max-width 350px.
- `.inline-track .artist`: color var(--text-muted).

**Page Header:**
- `.page-header`: flex, justify-content space-between, align-items center, margin-bottom 0.75rem.
- `.page-header h2`: margin-bottom 0.

### Utility Classes

| Class              | Styles                             |
|--------------------|-------------------------------------|
| `.text-muted`      | `color: var(--text-muted)`          |
| `.text-sm`         | `font-size: 0.85rem`                |
| `.mono`            | `font-family: var(--font-mono)`     |
| `.mt-1`            | `margin-top: 0.5rem`                |
| `.mt-2`            | `margin-top: 1rem`                  |
| `.mb-1`            | `margin-bottom: 0.5rem`             |
| `.mb-2`            | `margin-bottom: 1rem`               |
| `.gap-1`           | `gap: 0.5rem`                       |
| `.flex`            | `display: flex`                     |
| `.items-center`    | `align-items: center`               |
| `.justify-between` | `justify-content: space-between`    |

Typography: `h2` is 1.15rem, margin-bottom 0.6rem.

---

## API Client (`web/src/api/client.ts`)

### Base Configuration

- `const BASE = "/api"` -- all requests go through the Vite proxy.
- Generic `request<T>(path, init?)` function:
  - Prepends `BASE` to `path`.
  - Sets `Content-Type: application/json` header.
  - On non-ok response: parses body for `error` field, throws `Error(body.error ?? "HTTP {status}")`.
  - Returns `res.json()` typed as `T`.

### API Methods

#### Playlists

| Method                  | HTTP Method | Path                             | Return Type                                                        |
|-------------------------|-------------|----------------------------------|--------------------------------------------------------------------|
| `getPlaylists()`        | GET         | `/playlists`                     | `Playlist[]`                                                       |
| `getPlaylistStats()`    | GET         | `/playlists/stats`               | `LibraryStats`                                                     |
| `getPlaylist(id)`       | GET         | `/playlists/${id}`               | `Playlist`                                                         |
| `getPlaylistTracks(id)` | GET         | `/playlists/${id}/tracks`        | `Track[]`                                                          |
| `renamePlaylist(id, name)` | PUT      | `/playlists/${id}/rename`        | `{ ok: boolean }`                                                  |
| `deletePlaylist(id)`    | DELETE      | `/playlists/${id}`               | `{ ok: boolean }`                                                  |
| `pushPlaylist(id)`      | POST        | `/playlists/${id}/push`          | `PushResult`                                                       |
| `repairPlaylist(id)`    | POST        | `/playlists/${id}/repair`        | `RepairResult`                                                     |
| `updatePlaylistMeta(id, meta)` | PATCH | `/playlists/${id}`              | `{ ok: boolean }`                                                  |
| `mergePlaylists(targetId, sourceIds)` | POST | `/playlists/${targetId}/merge` | `{ ok: boolean; added: number; duplicatesSkipped: number }`       |
| `bulkRename(params)`    | POST        | `/playlists/bulk-rename`         | `BulkRenameResult`                                                 |
| `syncPlaylists()`       | POST        | `/playlists/sync`                | `{ ok: boolean; added: number; updated: number; unchanged: number }` |
| `getPlaylistDuplicates(id)` | GET     | `/playlists/${id}/duplicates`    | `DuplicateGroup[]`                                                 |
| `getCrossPlaylistDuplicates()` | GET  | `/playlists/duplicates`          | `CrossPlaylistDuplicate[]`                                         |
| `getSimilarPlaylists(threshold?)` | GET | `/playlists/similar[?threshold=N]` | `SimilarPair[]`                                                  |

#### Tracks

| Method                    | HTTP Method | Path                     | Return Type     |
|---------------------------|-------------|--------------------------|-----------------|
| `getTracks(q?)`           | GET         | `/tracks[?q=...]`        | `Track[]`       |
| `getTrack(id)`            | GET         | `/tracks/${id}`          | `Track`         |
| `getTrackLifecycle(id)`   | GET         | `/tracks/${id}/lifecycle` | `TrackLifecycle` |

#### Matches

| Method                          | HTTP Method | Path                  | Return Type       |
|---------------------------------|-------------|-----------------------|-------------------|
| `getMatches(status?)`           | GET         | `/matches[?status=]`  | `MatchWithTrack[]` |
| `updateMatch(id, status)`       | PUT         | `/matches/${id}`      | `Match`           |

#### Downloads

| Method                  | HTTP Method | Path                      | Return Type          |
|-------------------------|-------------|---------------------------|----------------------|
| `getDownloads(status?)` | GET         | `/downloads[?status=]`    | `DownloadWithTrack[]` |

#### Status

| Method              | HTTP Method | Path                  | Return Type                                        |
|---------------------|-------------|-----------------------|----------------------------------------------------|
| `getStatus()`       | GET         | `/status`             | `HealthStatus`                                     |
| `getConfig()`       | GET         | `/status/config`      | `AppConfig`                                        |
| `updateConfig(config)` | PUT      | `/status/config`      | `{ ok: boolean }`                                  |

#### Spotify Auth

| Method                  | HTTP Method | Path                          | Return Type                                          |
|-------------------------|-------------|-------------------------------|------------------------------------------------------|
| `startSpotifyLogin()`   | POST        | `/status/spotify/login`       | `{ ok: boolean; authUrl?: string; error?: string }`  |
| `getSpotifyAuthStatus()`| GET         | `/status/spotify/auth-status` | `{ authenticated: boolean; pending: boolean }`       |
| `spotifyLogout()`       | DELETE      | `/status/spotify/login`       | `{ ok: boolean }`                                    |

#### Soulseek

| Method                    | HTTP Method | Path                           | Return Type                          |
|---------------------------|-------------|--------------------------------|--------------------------------------|
| `connectSoulseek(params)` | PUT         | `/status/soulseek/connect`     | `{ ok: boolean; error?: string }`    |
| `disconnectSoulseek()`    | DELETE      | `/status/soulseek/connect`     | `{ ok: boolean }`                    |

#### Sync

| Method                              | HTTP Method | Path                           | Return Type                             |
|-------------------------------------|-------------|--------------------------------|-----------------------------------------|
| `startSync(playlistId)`             | POST        | `/sync/${playlistId}`          | `{ syncId: string; jobId?: string }`    |
| `dryRunSync(playlistId)`            | POST        | `/sync/${playlistId}/dry-run`  | `PhaseOneResult`                        |
| `getSyncStatus(syncId)`             | GET         | `/sync/${syncId}`              | `SyncStatus`                            |
| `submitReview(syncId, decisions)`   | POST        | `/sync/${syncId}/review`       | `{ ok: boolean }`                       |
| `syncEvents(syncId)`                | --          | `/sync/${syncId}/events`       | `EventSource` (SSE, not a fetch call)   |

#### Jobs

| Method                           | HTTP Method | Path                       | Return Type              |
|----------------------------------|-------------|----------------------------|--------------------------|
| `getJobs(params?)`               | GET         | `/jobs[?type=&status=&limit=&offset=]` | `JobListResponse` |
| `getJob(id)`                     | GET         | `/jobs/${id}`              | `JobDetail`              |
| `getJobStats()`                  | GET         | `/jobs/stats`              | `JobStats`               |
| `retryJob(id)`                   | POST        | `/jobs/${id}/retry`        | `{ ok: boolean }`        |
| `cancelJob(id)`                  | DELETE      | `/jobs/${id}`              | `{ ok: boolean }`        |
| `retryAllJobs(type?)`            | POST        | `/jobs/retry-all`          | `{ retried: number }`   |
| `jobEvents()`                    | --          | `/jobs/stream`             | `EventSource` (SSE)      |

### Exported TypeScript Interfaces

```typescript
interface Playlist {
  id: string;
  spotifyId: string | null;
  name: string;
  description: string | null;
  snapshotId: string | null;
  isOwned: number | null;
  ownerId: string | null;
  ownerName: string | null;
  tags: string | null;
  notes: string | null;
  pinned: number | null;
  lastSynced: number | null;
  totalDurationMs?: number;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
}

interface LibraryStats {
  totalPlaylists: number;
  totalTracks: number;
  totalDurationMs: number;
}

interface PlaylistMeta {
  tags?: string[];
  notes?: string;
  pinned?: boolean;
}

interface Track {
  id: string;
  spotifyId: string | null;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  isrc: string | null;
  spotifyUri: string | null;
  position?: number;
  createdAt: number;
  updatedAt: number;
}

interface Match {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
  status: "pending" | "confirmed" | "rejected";
  createdAt: number;
  updatedAt: number;
}

interface LexiconTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  lastSynced: number;
}

interface MatchWithTrack extends Match {
  sourceTrack: Track | null;
  targetTrack: LexiconTrack | null;
}

interface DownloadWithTrack {
  id: string;
  trackId: string;
  playlistId: string | null;
  status: string;
  soulseekPath: string | null;
  filePath: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  track: Track | null;
}

interface HealthStatus {
  spotify: { ok: boolean; error?: string };
  lexicon: { ok: boolean; error?: string };
  soulseek: { ok: boolean; error?: string };
  database: { ok: boolean; playlists?: number; tracks?: number; matches?: number; downloads?: number; error?: string };
}

interface AppConfig {
  matching: { autoAcceptThreshold: number; reviewThreshold: number };
  download: { formats: string[]; minBitrate: number; concurrency: number };
}

interface PhaseOneResult {
  playlistName: string;
  found: MatchedTrack[];
  needsReview: MatchedTrack[];
  notFound: Array<{ dbTrackId: string; track: { title: string; artist: string } }>;
  total: number;
}

interface MatchedTrack {
  dbTrackId: string;
  track: { title: string; artist: string };
  lexiconTrackId?: string;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

interface SyncStatus {
  syncId: string;
  playlistId: string;
  status: "running" | "awaiting-review" | "done" | "error";
  eventCount: number;
}

interface ReviewDecision {
  dbTrackId: string;
  accepted: boolean;
}

interface TrackLifecycle {
  track: Track;
  playlists: Array<{ playlistId: string; position: number; playlistName: string }>;
  matches: Match[];
  downloads: DownloadWithTrack[];
  jobs: JobItem[];
}

interface JobItem {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  priority: number;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  maxAttempts: number;
  runAfter: number | null;
  parentJobId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

interface JobDetail extends JobItem {
  children: JobItem[];
}

interface JobListResponse {
  jobs: JobItem[];
  total: number;
  limit: number;
  offset: number;
}

interface JobStats {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

interface PushResult {
  ok: boolean;
  renamed: boolean;
  descriptionUpdated: boolean;
  added: number;
  removed: number;
  message?: string;
}

interface RepairResult {
  ok: boolean;
  playlistName: string;
  total: number;
  found: number;
  needsReview: number;
  notFound: number;
}

interface DuplicateGroup {
  track: Track;
  duplicates: Track[];
}

interface CrossPlaylistDuplicate {
  track: Track;
  playlists: Playlist[];
}

interface SimilarPair {
  a: Playlist;
  b: Playlist;
  score: number;
}

interface BulkRenameParams {
  mode: "find-replace" | "prefix" | "suffix";
  find?: string;
  replace?: string;
  value?: string;
  action?: "add" | "remove";
  dryRun: boolean;
}

interface BulkRenamePreview {
  id: string;
  name: string;
  newName: string;
}

type BulkRenameResult = BulkRenamePreview[];
```

---

## React Query Hooks (`web/src/api/hooks.ts`)

Every hook follows the pattern: `useQuery` for reads, `useMutation` for writes, with `useQueryClient()` for cache invalidation in mutations.

### Query Hooks

| Hook                                       | queryKey                          | queryFn                            | Options                                      |
|--------------------------------------------|-----------------------------------|------------------------------------|----------------------------------------------|
| `usePlaylists()`                           | `["playlists"]`                   | `api.getPlaylists`                 |                                              |
| `usePlaylistStats()`                       | `["playlist-stats"]`              | `api.getPlaylistStats`             |                                              |
| `usePlaylist(id)`                          | `["playlist", id]`               | `api.getPlaylist(id)`              |                                              |
| `usePlaylistTracks(id)`                    | `["playlist-tracks", id]`        | `api.getPlaylistTracks(id)`        |                                              |
| `usePlaylistDuplicates(id, enabled)`       | `["playlist-duplicates", id]`    | `api.getPlaylistDuplicates(id)`    | `enabled` param                              |
| `useCrossPlaylistDuplicates(enabled)`      | `["cross-playlist-duplicates"]`  | `api.getCrossPlaylistDuplicates`   | `enabled` param                              |
| `useSimilarPlaylists(threshold, enabled)`  | `["similar-playlists", threshold]`| `api.getSimilarPlaylists(threshold)`| `enabled` param                             |
| `useMatches(status?)`                      | `["matches", status]`            | `api.getMatches(status)`           |                                              |
| `useDownloads(status?)`                    | `["downloads", status]`          | `api.getDownloads(status)`         | `refetchInterval: 5000`                      |
| `useStatus()`                              | `["status"]`                     | `api.getStatus`                    |                                              |
| `useConfig()`                              | `["config"]`                     | `api.getConfig`                    |                                              |
| `useSpotifyAuthStatus(enabled)`            | `["spotify-auth-status"]`        | `api.getSpotifyAuthStatus`         | `enabled`, `refetchInterval: enabled ? 2000 : false`, `select` invalidates `["status"]` on authenticated |
| `useTrackLifecycle(id)`                    | `["track-lifecycle", id]`        | `api.getTrackLifecycle(id)`        | `enabled: !!id`                              |
| `useJobs(params?)`                         | `["jobs", params]`               | `api.getJobs(params)`              | `refetchInterval: 3000`                      |
| `useJob(id)`                               | `["job", id]`                    | `api.getJob(id)`                   | `refetchInterval: 3000`                      |
| `useJobStats()`                            | `["job-stats"]`                  | `api.getJobStats`                  | `refetchInterval: 5000`                      |

### Mutation Hooks with Invalidation Patterns

| Hook                     | mutationFn                                            | Invalidates on success                                   |
|--------------------------|-------------------------------------------------------|----------------------------------------------------------|
| `useRenamePlaylist()`    | `api.renamePlaylist(id, name)`                        | `["playlists"]`, `["playlist"]`                          |
| `useUpdatePlaylistMeta()`| `api.updatePlaylistMeta(id, meta)`                    | `["playlists"]`, `["playlist"]`                          |
| `useDeletePlaylist()`    | `api.deletePlaylist(id)`                              | `["playlists"]`                                          |
| `useBulkRename()`        | `api.bulkRename(params)`                              | `["playlists"]`, `["playlist"]` (only if `!dryRun`)      |
| `useSyncPlaylists()`     | `api.syncPlaylists`                                   | `["playlists"]`, `["status"]`                            |
| `useMergePlaylists()`    | `api.mergePlaylists(targetId, sourceIds)`              | `["playlists"]`, `["playlist"]`, `["playlist-tracks"]`   |
| `usePushPlaylist()`      | `api.pushPlaylist(id)`                                | (none)                                                   |
| `useRepairPlaylist()`    | `api.repairPlaylist(id)`                              | (none)                                                   |
| `useUpdateMatch()`       | `api.updateMatch(id, status)`                         | `["matches"]`                                            |
| `useUpdateConfig()`      | `api.updateConfig`                                    | `["config"]`                                             |
| `useStartSpotifyLogin()` | `api.startSpotifyLogin`                               | (none)                                                   |
| `useSpotifyLogout()`     | `api.spotifyLogout`                                   | `["status"]`                                             |
| `useConnectSoulseek()`   | `api.connectSoulseek(params)`                         | `["status"]`                                             |
| `useDisconnectSoulseek()`| `api.disconnectSoulseek`                              | `["status"]`                                             |
| `useStartSync()`         | `api.startSync(playlistId)`                           | (none)                                                   |
| `useDryRunSync()`        | `api.dryRunSync(playlistId)`                          | (none)                                                   |
| `useRetryJob()`          | `api.retryJob(id)`                                    | `["jobs"]`, `["job-stats"]`                              |
| `useCancelJob()`         | `api.cancelJob(id)`                                   | `["jobs"]`, `["job-stats"]`                              |
| `useRetryAllJobs()`      | `api.retryAllJobs(type?)`                             | `["jobs"]`, `["job-stats"]`                              |

---

## Error Handling

- The `request<T>()` function throws on non-2xx responses with the error message from the response body, or a generic `"HTTP {status}"`.
- React Query's `isError` and `error.message` surface these errors in the UI.
- The `QueryClient` staleTime of 30s prevents aggressive refetching while keeping data reasonably fresh.
- Hooks with `refetchInterval` (downloads, jobs, job stats, spotify auth status) provide near-realtime updates for actively changing data.

---

## Tests

### Unit Tests

- Verify the `request()` function correctly prepends `BASE`, sets headers, throws on error responses.
- Verify each `api.*` method calls fetch with the correct path and HTTP method.
- Verify hook queryKeys are stable for the same inputs (important for cache behavior).

### Integration Tests

- With MSW or similar, verify the API client correctly parses typed responses.
- Verify the QueryClient staleTime is 30000.
- Verify the route table renders the correct component for each path.

---

## Acceptance Criteria

1. `web/package.json` lists the exact dependencies and versions specified.
2. Vite dev server proxies `/api` to `http://localhost:3100` on port 5173.
3. React root uses `StrictMode`, `QueryClientProvider` with 30s staleTime, and `BrowserRouter`.
4. All 10 routes are defined and nested under the `App` layout.
5. App layout has a fixed 180px sidebar with NavLinks in the documented order and a service status indicator section.
6. All CSS custom properties, component classes, badge variants, button variants, and utility classes are defined as documented.
7. Every API method in the client has the exact path, HTTP method, and TypeScript return type.
8. Every exported interface matches the documented shape exactly.
9. Every React Query hook has the correct queryKey and mutation invalidation pattern.
10. `syncEvents()` and `jobEvents()` return `EventSource` instances (not fetch-based).
