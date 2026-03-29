---
# spec-20
title: "Web frontend"
status: todo
type: task
priority: high
parent: spec-E5
depends_on: spec-18
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

# Web Frontend

## Purpose

Define the complete web application: package configuration, build tooling, React root, application layout, CSS design system, API client with TypeScript types, React Query hooks, route definitions, and all pages (dashboard, playlists, playlist detail, track detail, review, matches, downloads, queue, job detail, settings).

---

## 1. Package & Build

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

### React Root Setup (`web/src/main.tsx`)

1. Creates a `QueryClient` with `defaultOptions.queries.staleTime = 30_000` (30 seconds).
2. Renders into `document.getElementById("root")!` via `createRoot`.
3. Wraps the app in: `StrictMode` > `QueryClientProvider` > `BrowserRouter` > `Routes`.
4. Imports `./styles/globals.css` for the design system.

---

## 2. App Layout & CSS Design System

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
    - Review (`/review`) -- **badge showing pending review count** from `useReviewStats()`. Badge is always visible when count > 0, styled as `.badge-yellow` inline next to the nav label.
    - Matches (`/matches`)
    - Downloads (`/downloads`)
    - Queue (`/queue`)
    - Settings (`/settings`)
  - **Service status indicators** at bottom (pushed down with `marginTop: "auto"`): shows `StatusDot` (8px colored circles: green `#1db954` for ok, red `#e74c3c` for error) for Spotify, Lexicon, Soulseek, Database. Data from `useStatus()` hook.

- **Content area** (`.content`, `margin-left: 180px`):
  - Renders `<Outlet />` for the matched route component.

### CSS Design System (`web/src/styles/globals.css`)

#### Custom Properties

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

#### Global Reset

- `* { margin: 0; padding: 0; box-sizing: border-box; }`
- `body`: font-family var(--font), bg var(--bg), color var(--text), line-height 1.4, font-size 14px.
- `a`: color var(--accent), no underline; hover var(--accent-hover).

#### Layout Classes

| Class      | Styles                                                                  |
|------------|-------------------------------------------------------------------------|
| `.app`     | `display: flex; min-height: 100vh`                                       |
| `.sidebar` | `width: 180px; background: var(--bg-card); border-right: 1px solid var(--border); padding: 1rem 0; position: fixed; top: 0; bottom: 0; overflow-y: auto` |
| `.content` | `margin-left: 180px; flex: 1; padding: 1.25rem 1.5rem`                  |

#### Sidebar Styles

- `.sidebar h1`: font-size 1rem, padding 0 1rem 0.75rem, border-bottom.
- `.sidebar nav a`: display block, padding 0.35rem 1rem, color var(--text-muted), font-size 0.85rem, transition on background + color.
- `.sidebar nav a:hover, .sidebar nav a.active`: background var(--bg-hover), color var(--text).
- `.sidebar .review-badge`: display inline-block, margin-left 0.3rem, font-size 0.7rem, vertical-align middle.

#### Component Classes

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

**Side-by-Side Comparison:**
- `.comparison-grid`: display grid, grid-template-columns 1fr 1fr, gap 1rem.
- `.comparison-panel`: bg var(--bg-card), border, border-radius var(--radius), padding 0.75rem 1rem.
- `.comparison-panel h4`: font-size 0.85rem, text-transform uppercase, letter-spacing 0.05em, color var(--text-muted), margin-bottom 0.5rem.

#### Utility Classes

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

## 3. API Client & Hooks

### Base Configuration (`web/src/api/client.ts`)

- `const BASE = "/api"` -- all requests go through the Vite proxy.
- Generic `request<T>(path, init?)` function:
  - Prepends `BASE` to `path`.
  - Sets `Content-Type: application/json` header.
  - On non-ok response: parses body for `error` field, throws `Error(body.error ?? "HTTP {status}")`.
  - Returns `res.json()` typed as `T`.

### API Methods

#### Playlists

| Method                         | HTTP Method | Path                             | Return Type          |
|--------------------------------|-------------|----------------------------------|----------------------|
| `getPlaylists()`               | GET         | `/playlists`                     | `Playlist[]`         |
| `getPlaylist(id)`              | GET         | `/playlists/${id}`               | `Playlist`           |
| `getPlaylistTracks(id)`        | GET         | `/playlists/${id}/tracks`        | `Track[]`            |
| `renamePlaylist(id, name)`     | PUT         | `/playlists/${id}/rename`        | `{ ok: boolean }`    |
| `deletePlaylist(id)`           | DELETE      | `/playlists/${id}`               | `{ ok: boolean }`    |
| `pushPlaylist(id)`             | POST        | `/playlists/${id}/push`          | `PushResult`         |
| `updatePlaylistMeta(id, meta)` | PATCH       | `/playlists/${id}`               | `{ ok: boolean }`    |
| `bulkRename(params)`           | POST        | `/playlists/bulk-rename`         | `BulkRenameResult`   |
| `syncPlaylists()`              | POST        | `/playlists/sync`                | `SyncResult`         |

#### Tracks

| Method                    | HTTP Method | Path                      | Return Type      |
|---------------------------|-------------|---------------------------|------------------|
| `getTracks(q?)`           | GET         | `/tracks[?q=...]`         | `Track[]`        |
| `getTrack(id)`            | GET         | `/tracks/${id}`           | `Track`          |
| `getTrackLifecycle(id)`   | GET         | `/tracks/${id}/lifecycle` | `TrackLifecycle` |
| `getTrackRejections(id)`  | GET         | `/tracks/${id}/rejections`| `Rejection[]`    |

#### Review

| Method                              | HTTP Method | Path                          | Return Type     |
|-------------------------------------|-------------|-------------------------------|-----------------|
| `getReviewPending()`                | GET         | `/review`                     | `PendingReviewItem[]` |
| `getReviewStats()`                  | GET         | `/review/stats`               | `ReviewStats`   |
| `confirmReview(id)`                 | POST        | `/review/${id}/confirm`       | `{ ok: boolean }` |
| `rejectReview(id)`                  | POST        | `/review/${id}/reject`        | `{ ok: boolean }` |
| `bulkConfirmReviews(ids)`           | POST        | `/review/bulk`                | `{ ok: boolean; count: number }` |
| `bulkRejectReviews(ids)`            | POST        | `/review/bulk`                | `{ ok: boolean; count: number }` |

Note: `bulkConfirmReviews` sends `{ action: "confirm", ids }`, `bulkRejectReviews` sends `{ action: "reject", ids }`.

#### Matches

| Method                          | HTTP Method | Path                  | Return Type        |
|---------------------------------|-------------|-----------------------|--------------------|
| `getMatches(status?)`           | GET         | `/matches[?status=]`  | `MatchWithTrack[]` |

#### Downloads

| Method                  | HTTP Method | Path                      | Return Type          |
|-------------------------|-------------|---------------------------|----------------------|
| `getDownloads(status?)` | GET         | `/downloads[?status=]`    | `DownloadWithTrack[]` |

#### Wishlist

| Method            | HTTP Method | Path              | Return Type     |
|-------------------|-------------|--------------------|-----------------|
| `runWishlist()`   | POST        | `/wishlist/run`    | `{ ok: boolean; jobId: string }` |

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
| `dryRunSync(playlistId)`            | POST        | `/sync/${playlistId}/dry-run`  | `DryRunResult`                          |
| `getSyncStatus(syncId)`             | GET         | `/sync/${syncId}`              | `SyncStatus`                            |
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

### Exported TypeScript Types

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
  trackCount: number;
  createdAt: number;
  updatedAt: number;
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
  parkedAt: number | null;
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

interface PendingReviewItem {
  matchId: string;
  spotifyTrack: Track;
  lexiconTrack: LexiconTrack;
  score: number;
  confidence: string;
  method: string;
  playlistName: string;
  parkedAt: number;
}

interface ReviewStats {
  pending: number;
  confirmedToday: number;
  rejectedToday: number;
}

interface Rejection {
  id: string;
  trackId: string;
  context: "lexicon_match" | "soulseek_download";
  fileKey: string | null;
  targetTrackId: string | null;
  reason: string | null;
  createdAt: number;
}

interface DownloadWithTrack {
  id: string;
  trackId: string;
  playlistId: string | null;
  origin: "not_found" | "review_rejected";
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
  download: { formats: string[]; minBitrate: number; concurrency: number; validationStrictness: string };
}

interface DryRunResult {
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
  status: "running" | "done" | "error";
  eventCount: number;
}

interface SyncResult {
  ok: boolean;
  added: number;
  updated: number;
  unchanged: number;
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

interface BulkRenameParams {
  pattern: string;
  replacement: string;
  dryRun: boolean;
}

interface BulkRenamePreview {
  id: string;
  name: string;
  newName: string;
}

type BulkRenameResult = BulkRenamePreview[];
```

### React Query Hooks (`web/src/api/hooks.ts`)

Every hook follows the pattern: `useQuery` for reads, `useMutation` for writes, with `useQueryClient()` for cache invalidation in mutations.

#### Query Hooks

| Hook                                       | queryKey                          | queryFn                            | Options                                      |
|--------------------------------------------|-----------------------------------|------------------------------------|----------------------------------------------|
| `usePlaylists()`                           | `["playlists"]`                   | `api.getPlaylists`                 |                                              |
| `usePlaylist(id)`                          | `["playlist", id]`               | `api.getPlaylist(id)`              |                                              |
| `usePlaylistTracks(id)`                    | `["playlist-tracks", id]`        | `api.getPlaylistTracks(id)`        |                                              |
| `useMatches(status?)`                      | `["matches", status]`            | `api.getMatches(status)`           |                                              |
| `useDownloads(status?)`                    | `["downloads", status]`          | `api.getDownloads(status)`         | `refetchInterval: 5000`                      |
| `useReviewPending()`                       | `["review-pending"]`             | `api.getReviewPending`             |                                              |
| `useReviewStats()`                         | `["review-stats"]`               | `api.getReviewStats`               | `refetchInterval: 10000`                     |
| `useTrackRejections(id)`                   | `["track-rejections", id]`       | `api.getTrackRejections(id)`       | `enabled: !!id`                              |
| `useStatus()`                              | `["status"]`                     | `api.getStatus`                    |                                              |
| `useConfig()`                              | `["config"]`                     | `api.getConfig`                    |                                              |
| `useSpotifyAuthStatus(enabled)`            | `["spotify-auth-status"]`        | `api.getSpotifyAuthStatus`         | `enabled`, `refetchInterval: enabled ? 2000 : false`, `select` invalidates `["status"]` on authenticated |
| `useTrackLifecycle(id)`                    | `["track-lifecycle", id]`        | `api.getTrackLifecycle(id)`        | `enabled: !!id`                              |
| `useJobs(params?)`                         | `["jobs", params]`               | `api.getJobs(params)`              | `refetchInterval: 3000`                      |
| `useJob(id)`                               | `["job", id]`                    | `api.getJob(id)`                   | `refetchInterval: 3000`                      |
| `useJobStats()`                            | `["job-stats"]`                  | `api.getJobStats`                  | `refetchInterval: 5000`                      |

#### Mutation Hooks with Invalidation Patterns

| Hook                       | mutationFn                                            | Invalidates on success                                   |
|----------------------------|-------------------------------------------------------|----------------------------------------------------------|
| `useRenamePlaylist()`      | `api.renamePlaylist(id, name)`                        | `["playlists"]`, `["playlist"]`                          |
| `useUpdatePlaylistMeta()`  | `api.updatePlaylistMeta(id, meta)`                    | `["playlists"]`, `["playlist"]`                          |
| `useDeletePlaylist()`      | `api.deletePlaylist(id)`                              | `["playlists"]`                                          |
| `useBulkRename()`          | `api.bulkRename(params)`                              | `["playlists"]`, `["playlist"]` (only if `!dryRun`)      |
| `useSyncPlaylists()`       | `api.syncPlaylists`                                   | `["playlists"]`, `["status"]`                            |
| `usePushPlaylist()`        | `api.pushPlaylist(id)`                                | (none)                                                   |
| `useConfirmReview()`       | `api.confirmReview(id)`                               | `["review-pending"]`, `["review-stats"]`, `["matches"]`  |
| `useRejectReview()`        | `api.rejectReview(id)`                                | `["review-pending"]`, `["review-stats"]`, `["matches"]`, `["downloads"]` |
| `useBulkConfirmReviews()`  | `api.bulkConfirmReviews(ids)`                         | `["review-pending"]`, `["review-stats"]`, `["matches"]`  |
| `useBulkRejectReviews()`   | `api.bulkRejectReviews(ids)`                          | `["review-pending"]`, `["review-stats"]`, `["matches"]`, `["downloads"]` |
| `useWishlistRun()`         | `api.runWishlist`                                     | `["jobs"]`, `["job-stats"]`                              |
| `useUpdateConfig()`        | `api.updateConfig`                                    | `["config"]`                                             |
| `useStartSpotifyLogin()`   | `api.startSpotifyLogin`                               | (none)                                                   |
| `useSpotifyLogout()`       | `api.spotifyLogout`                                   | `["status"]`                                             |
| `useConnectSoulseek()`     | `api.connectSoulseek(params)`                         | `["status"]`                                             |
| `useDisconnectSoulseek()`  | `api.disconnectSoulseek`                              | `["status"]`                                             |
| `useStartSync()`           | `api.startSync(playlistId)`                           | (none)                                                   |
| `useDryRunSync()`          | `api.dryRunSync(playlistId)`                          | (none)                                                   |
| `useRetryJob()`            | `api.retryJob(id)`                                    | `["jobs"]`, `["job-stats"]`                              |
| `useCancelJob()`           | `api.cancelJob(id)`                                   | `["jobs"]`, `["job-stats"]`                              |
| `useRetryAllJobs()`        | `api.retryAllJobs(type?)`                             | `["jobs"]`, `["job-stats"]`                              |

---

## 4. Pages

### 4.1 Dashboard (`web/src/pages/Dashboard.tsx`)

**Route:** `/`

**Data fetched:**
- `useStatus()` -- service health
- `usePlaylists()` -- playlist count
- `useReviewStats()` -- pending review count
- `useDownloads()` -- active download count
- `useJobStats()` -- job status counts

**Layout:**

1. **Heading:** `<h2>Dashboard</h2>`

2. **Stat cards grid** (`.grid-stats`):
   - **Playlists:** `playlists.length`.
   - **Tracks:** `status.database.tracks` (dash if unavailable).
   - **Pending Reviews:** `reviewStats.pending`.
   - **Active Downloads:** count of downloads with status `"downloading"` or `"searching"`.
   - **Queued Jobs:** `jobStats.byStatus.queued ?? 0`.

3. **Service Status card** (`.card`):
   - `<h3>Service Status</h3>`
   - Table with columns: Service, Status, Details.
   - Rows:
     - **SpotifyRow** (custom component): badge-green "Connected" / badge-red "Error". Details column shows:
       - If connected: "Logout" danger button (calls `useSpotifyLogout`).
       - If not connected and not polling: "Login" primary button. Clicking calls `useStartSpotifyLogin().mutateAsync()`. On success, opens `authUrl` in new tab (`window.open`), starts polling via `useSpotifyAuthStatus(polling=true)` with 2s interval. When `authStatus.authenticated` becomes true, stops polling.
       - If polling: "Waiting for authorization..." text.
       - Error display in danger color if login fails.
     - **Lexicon:** generic ServiceRow -- badge-green/red, shows error message if any.
     - **SoulseekRow** (custom component): badge-green/red. Details column shows:
       - If connected: "Disconnect" danger button (calls `useDisconnectSoulseek`).
       - If not connected: "Connect" primary button toggles a form row.
       - Form row (shown below the Soulseek row, spanning all 3 columns): two inputs (slskd URL, default `http://localhost:5030`; API Key, password type) and "Connect" primary button. Calls `useConnectSoulseek().mutateAsync({ slskdUrl, slskdApiKey })`. On success, hides form and clears API key. On error, shows error message.
     - **Database:** generic ServiceRow -- shows `"{N} playlists, {N} tracks"` when ok.

---

### 4.2 Playlists (`web/src/pages/Playlists.tsx`)

**Route:** `/playlists`

**Data fetched:**
- `usePlaylists()` -- all playlists.
- `useSyncPlaylists()` -- mutation for syncing from Spotify.
- `useRenamePlaylist()`, `useDeletePlaylist()`, `useBulkRename()` -- mutations.
- `useMultiSelect()` -- selection state.

**State management:**
- URL search params persist filter/sort state: `q` (search), `sort` (key), `dir` (direction), `owner` (ownership filter), `tag` (tag filter).
- Types: `SortKey = "name" | "trackCount" | "ownerName" | "lastSynced"`, `SortDir = "asc" | "desc"`, `OwnershipFilter = "all" | "own" | "followed"`.
- `allTags` computed via `useMemo`: scans all playlists, extracts tags from JSON-stored `tags` field, deduplicates and sorts.

**Layout:**

1. **Page header** (`.page-header`):
   - `<h2>Playlists</h2>`
   - Actions row:
     - "Sync from Spotify" primary button (calls `sync.mutate()`; disabled while pending; shows "Syncing...").
     - "Bulk Rename" button (opens BulkRenameModal).
     - Ownership filter: 3 buttons (All/Own/Followed), active one gets `.primary` class.
     - Tag filter `<select>`: "All Tags" + all discovered tags.
     - Search input: `placeholder="Search playlists..."`, width 220px.

2. **Sync result feedback:** Green text showing added/updated/unchanged counts, or danger-colored error.

3. **Playlist table** (inside `.card`):
   - **Header row:** Checkbox (select all / indeterminate), sortable headers (Name, Tracks, Owner [hidden when `ownership === "own"`], Last Synced), empty actions column.
   - Sorting: click header toggles direction; `SortHeader` component adds triangle indicator.
   - **Filtering logic** (`useMemo`):
     - Ownership filter: `isOwned === 1` for own, `isOwned === 0` for followed.
     - Search: case-insensitive name includes.
     - Tag filter: checks parsed JSON tags array.
     - Sort: pinned playlists always float to top. Then by active sort key/direction.
   - **Row content:**
     - Checkbox for selection.
     - Name cell: optional "pinned" badge (badge-green), Link to `/playlists/{id}`, tag badges (badge-blue) from parsed tags.
     - Track count.
     - Owner (if visible): "You" for owned, ownerName otherwise.
     - Last Synced: formatted date or dash.
     - Actions: View (Link), Rename (disabled for followed), Delete danger (disabled for followed).
   - **Empty state:** "No playlists match your filters." or instruction to run `crate-sync db sync`.

4. **Modals:**
   - **RenameModal:** input pre-filled with current name, "Cancel"/"Rename" buttons. Uses `useRenamePlaylist()`.
   - **DeleteModal:** confirmation text with name and track count, note that it doesn't delete from Spotify. "Cancel"/"Delete" danger button. Uses `useDeletePlaylist()`.
   - **BulkDeleteModal:** lists all selected playlists, has progress counter during deletion. Uses `useDeletePlaylist()` in a loop.
   - **BulkRenameModal:** Regex pattern input + replacement input. "Preview" button triggers dryRun, shows before/after table (old name -> new name for each affected playlist). "Apply" button commits. Uses `useBulkRename()`.

5. **Bulk Toolbar** (`.bulk-toolbar`): Shows when `selection.count > 0`. Contains "Delete Selected" danger button.

---

### 4.3 Playlist Detail (`web/src/pages/PlaylistDetail.tsx`)

**Route:** `/playlists/:id`

**Data fetched:**
- `usePlaylist(id)` -- playlist metadata.
- `usePlaylistTracks(id)` -- track list.
- `usePlaylists()` -- all playlists (for tag suggestions).
- `useStartSync()` -- sync mutation.
- `useRenamePlaylist()`, `useDeletePlaylist()`, `usePushPlaylist()`, `useUpdatePlaylistMeta()`.

**State management:**
- `syncId`, `syncEvents[]`, `syncPhase` -- for live sync progress.
- Track filtering: `trackSearch` (text), `trackSortKey`, `trackSortDir`.
- `notesValue` -- local textarea state, saves on blur.
- `tagInput` + `showTagSuggestions` -- for tag autocomplete.
- Computed: `totalDurationMs`, `uniqueArtists`, `topArtist`, `currentTags`, `allExistingTags`, `tagSuggestions`.

**Layout:**

1. **Page header:**
   - Back link `<- Playlists` to `/playlists`.
   - `<h2>{playlist.name}</h2>` + muted track count.
   - Action buttons: Pin/Unpin, Start Sync (primary, disabled during sync, shows phase), Push to Spotify (disabled for followed or no spotifyId), Rename (disabled for followed), Delete danger (disabled for followed).
   - **Push to Spotify:** before pushing, shows a preview of the description that will be synced (composed from tags + notes). Clicking confirms the push including description sync.

2. **Push result feedback:** Green success text or danger error text. Shows whether description was updated.

3. **Tags card:** Displays current tags as badge-blue with `x` to remove (click). Tag input with autocomplete dropdown (filtered from all existing tags across all playlists). Enter key adds new tag.

4. **Notes card:** Textarea with auto-save on blur. Calls `updatePlaylistMeta` with notes value.

5. **Sync progress card** (conditional, when syncEvents non-empty): Shows each SSE event as a badge with type + monospace JSON data.

6. **SSE integration:**
   - When `syncId` is set, creates `EventSource` via `api.syncEvents(syncId)`.
   - Listens for: `phase`, `match-complete`, `download-progress`, `sync-complete`, `error`.
   - Cleanup: closes EventSource on unmount or syncId change.

7. **Track list** (`.card`):
   - Filter input: `placeholder="Filter by title or artist..."`, width 220px.
   - Duration summary: `"Xh Ym across N tracks"`.
   - Sortable table: #, Title, Artist, Album, Duration. `ThSort` component.
   - Track sort options: position, title, artist, album, durationMs.
   - Row click navigates to `/tracks/{trackId}` via `useNavigate()`.
   - Empty filter state: "No tracks match your filter."

8. **Rename modal:** Same pattern as Playlists page RenameModal.

9. **Delete modal:** Same pattern. On delete, navigates to `/playlists`.

---

### 4.4 Track Detail (`web/src/pages/TrackDetail.tsx`)

**Route:** `/tracks/:id`

**Data fetched:**
- `useTrackLifecycle(id)` -- returns `{ track, playlists, matches, downloads, jobs }`.
- `useTrackRejections(id)` -- returns `Rejection[]`.

**Layout:**

1. **Page header:** `<h2>{track.title}</h2>`.

2. **Spotify Metadata card:** Table with rows: Artist, Album (or dash), Duration (formatted M:SS), ISRC (monospace, or dash), Spotify URI (monospace, small), Imported (formatted date).

3. **Playlists card:** `"Playlists ({N})"`. Table: Playlist (linked to `/playlists/{id}`), Position (1-indexed). Empty state: "Not in any playlist."

4. **Matches card:** `"Matches ({N})"`. Table: Target (type prefix + truncated ID), Score (monospace percentage), Method (badge-gray), Status (colored badge). Empty state: "No matches found."

   Badge mapping for match status: pending=badge-yellow, confirmed=badge-green, rejected=badge-red.

5. **Downloads card:** `"Downloads ({N})"`. Table: Status (colored badge), File (monospace, truncated, shows filePath or soulseekPath), Origin (`"not_found"` or `"review_rejected"` in badge-gray), Error (danger color), When (formatted date). Empty state: "No downloads."

   Badge mapping for download status: pending=badge-gray, searching=badge-blue, downloading=badge-blue, validating=badge-yellow, moving=badge-yellow, done=badge-green, failed=badge-red.

6. **Rejection History card:** `"Rejection History ({N})"`. Two sections:

   - **Match Rejections:** Filtered from rejections where `context === "lexicon_match"`. Table: Target Track ID (truncated), Reason, Date. Empty state: "No match rejections."

   - **Download Rejections:** Filtered from rejections where `context === "soulseek_download"`. Table: File Key (monospace, truncated), Reason, Date. Empty state: "No download rejections."

   Overall empty state: "No rejection history for this track."

7. **Jobs card** (conditional, only if jobs.length > 0): `"Jobs ({N})"`. Table: ID (linked to `/queue/{id}`, monospace, first 8 chars), Type (badge-gray with human label), Status (colored badge), Created (formatted date).

   Badge mapping for job status: queued=badge-blue, running=badge-yellow, done=badge-green, failed=badge-red.

---

### 4.5 Review (`web/src/pages/Review.tsx`)

**Route:** `/review`

**Data fetched:**
- `useReviewPending()` -- all pending review items.
- `useConfirmReview()`, `useRejectReview()` -- individual mutations.
- `useBulkConfirmReviews()`, `useBulkRejectReviews()` -- bulk mutations.

**Layout:**

1. **Page header:**
   - `<h2>Review ({N})</h2>` where N is the count of pending items.
   - Bulk action buttons (only shown when items exist):
     - "Confirm All" primary button -- calls `bulkConfirm.mutate(allIds)`.
     - "Reject All" danger button -- calls `bulkReject.mutate(allIds)`.
     - Both disabled while any mutation is pending.

2. **Empty state:** Card with muted "No pending matches to review."

3. **Review list** (when items exist): Each pending review item is rendered as a `.card` with a **side-by-side comparison** layout (`.comparison-grid`):

   - **Left panel** ("Spotify"):
     - `<h4>Spotify</h4>`
     - Track title as Link to `/tracks/{spotifyTrack.id}`.
     - Artist in muted text.
     - Album in muted text (if present).
     - Duration formatted as `M:SS`.
     - Playlist name in small badge-blue.

   - **Right panel** ("Lexicon"):
     - `<h4>Lexicon</h4>`
     - Track title.
     - Artist in muted text.
     - Album in muted text (if present).
     - Duration formatted as `M:SS` (if available).
     - File path in small monospace muted text.

   - **Footer row** (below the grid, within the card):
     - Score badge (colored by confidence: high=badge-green, review=badge-yellow, low=badge-red) showing `{N}%`.
     - Method badge (badge-gray).
     - Parked time (relative, e.g. "2 hours ago").
     - "Confirm" primary button.
     - "Reject & Queue Download" danger button.
     - Both disabled while mutation is pending.

**Behavioral note:** The Review page is always accessible from the sidebar regardless of whether a sync session is active. It shows all parked matches across all playlists. Rejecting a match auto-queues a download for that track (handled server-side by the review service).

---

### 4.6 Matches (`web/src/pages/Matches.tsx`)

**Route:** `/matches`

**Data fetched:**
- `useMatches(filter || undefined)` -- matches, optionally filtered.

**State:** `filter` (string, initially empty).

**Layout:**

1. **Page header:** `<h2>Matches</h2>` + status filter `<select>`: All, Pending, Confirmed, Rejected.

2. **Matches table** (`.card`):
   - Columns: Source Track, Score, Method, Confidence, Status.
   - **Source Track:** if `sourceTrack` exists, shows title + artist (in `.inline-track`). Otherwise shows raw `sourceId` in muted text.
   - **Score:** monospace, formatted as `{N}%`.
   - **Method:** badge-gray.
   - **Confidence:** badge-green (high), badge-yellow (review), badge-red (low).
   - **Status:** badge-green (confirmed), badge-red (rejected), badge-yellow (pending).
   - **Empty state:** "No matches found."

Note: individual confirm/reject actions for pending matches have been moved to the dedicated Review page. The Matches page is a read-only registry browser.

---

### 4.7 Downloads (`web/src/pages/Downloads.tsx`)

**Route:** `/downloads`

**Data fetched:**
- `useDownloads(filter || undefined)` -- with 5s refetch interval (inherited from hook).

**State:** `filter` (string, initially empty).

**Layout:**

1. **Page header:**
   - `<h2>Downloads</h2>` + status filter `<select>`: All, Pending, Downloading, Done, Failed.
   - "Run Wishlist" button: triggers `useWishlistRun()`. Disabled while pending. Shows "Running..." during mutation, then "Queued (job {shortId})" on success.

2. **Downloads table** (`.card`):
   - Columns: Track, Status, Origin, File, Error, Completed.
   - **Track:** if `track` exists, shows title + artist (in `.inline-track`). Otherwise shows raw `trackId`.
   - **Status:** colored badge using mapping: pending=badge-gray, searching=badge-blue, downloading=badge-blue, validating=badge-yellow, moving=badge-yellow, done=badge-green, failed=badge-red.
   - **Origin:** badge-gray showing `"not_found"` or `"review_rejected"`.
   - **File:** monospace, muted, small, truncated (max-width 350px), shows `filePath` or dash.
   - **Error:** small, danger-colored.
   - **Completed:** muted formatted date or dash.
   - **Empty state:** "No downloads."

---

### 4.8 Queue (`web/src/pages/Queue.tsx`)

**Route:** `/queue`

**Data fetched:**
- `useJobs({ status: statusFilter, type: typeFilter, limit: 50 })` -- with 3s refetch interval (from hook).
- `useJobStats()` -- with 5s refetch interval (from hook).
- `useRetryJob()`, `useCancelJob()`, `useRetryAllJobs()` -- mutations.

**State:**
- `statusFilter` (string, initially empty).
- `typeFilter` (string, initially empty).

**Type label mapping:**
```
spotify_sync   -> "Spotify Sync"
lexicon_match  -> "Lexicon Match"
lexicon_tag    -> "Lexicon Tag"
search         -> "Search"
download       -> "Download"
validate       -> "Validate"
wishlist_run   -> "Wishlist"
```

**Layout:**

1. **Page header:**
   - `<h2>Job Queue</h2>`
   - Filters row:
     - Status `<select>`: All Status, Queued, Running, Done, Failed.
     - Type `<select>`: All Types, + all type labels from mapping above.
     - "Retry All" button (only visible when `statusFilter === "failed"`): calls `retryAll.mutate(typeFilter || undefined)`. Shows retried count in parentheses after success. Disabled while pending.

2. **Stat cards grid** (conditional, when stats present):
   - **Queued:** `stats.byStatus.queued ?? 0`
   - **Running:** `stats.byStatus.running ?? 0`
   - **Done:** `stats.byStatus.done ?? 0`
   - **Failed:** `stats.byStatus.failed ?? 0`

3. **Job table** (`.card`):
   - Columns: ID, Type, Status, Details, Error, Created, Actions.
   - Each row rendered by `JobRow` component:
     - **ID:** Link to `/queue/{id}`, monospace small, first 8 chars.
     - **Type:** badge-gray with human-readable label from `typeLabel` mapping.
     - **Status:** colored badge (queued=badge-blue, running=badge-yellow, done=badge-green, failed=badge-red).
     - **Details:** if payload contains `title` or `artist`, shows `"{artist} -- {title}"` in `.inline-track`. Also shows attempt counter `{N}/{max}` in muted text (only when attempt > 0).
     - **Error:** danger-colored, truncated to 60 chars, max-width 200px with overflow ellipsis.
     - **Created:** muted formatted date.
     - **Actions:**
       - "Retry" button (only when `status === "failed"`): calls `retryJob.mutate(id)`.
       - "Cancel" danger button (only when `status === "queued"`): calls `cancelJob.mutate(id)`.
       - Both disabled while their respective mutations are pending.
   - **Empty state:** "No jobs found." spanning all 7 columns.

4. **Pagination notice:** When `data.total > jobs.length`, shows muted small text: `"Showing {N} of {total} jobs."`.

---

### 4.9 Job Detail (`web/src/pages/JobDetail.tsx`)

**Route:** `/queue/:id`

**Data fetched:**
- `useJob(id)` -- with 3s refetch interval (from hook).
- `useRetryJob()` -- mutation.

**Layout:**

1. **Page header:**
   - `<h2>Job {shortId} {status badge}</h2>` -- shortId is first 8 chars.
   - Actions: "Retry" button (only when `status === "failed"`), "Back to Queue" Link.

2. **Overview card:**
   - Table with rows:
     - **Type:** badge-gray with human label.
     - **Priority:** numeric value.
     - **Attempt:** `{attempt} / {maxAttempts}`.
     - **Created:** full formatted date (toLocaleString).
     - **Started:** full formatted date or dash.
     - **Completed:** full formatted date or dash.
     - **Parent** (conditional, only if `parentJobId` present): Link to `/queue/{parentJobId}`, monospace small, first 8 chars.

3. **Error card** (conditional, only if `job.error`):
   - Styled with `borderLeft: 3px solid var(--danger)`.
   - `<h3>Error</h3>` in danger color.
   - `<pre>` with white-space pre-wrap for the full error message.

4. **Payload card** (conditional, only if `job.payload`):
   - `<h3>Payload</h3>`
   - `<pre>` monospace, JSON.stringify with 2-space indent.

5. **Result card** (conditional, only if `job.result`):
   - `<h3>Result</h3>`
   - `<pre>` monospace, JSON.stringify with 2-space indent.

6. **Child Jobs card** (conditional, only if `job.children.length > 0`):
   - `<h3>Child Jobs ({N})</h3>`
   - Table: ID (linked to child detail page), Type (badge-gray), Status (colored badge), Created (muted date).

---

### 4.10 Settings (`web/src/pages/Settings.tsx`)

**Route:** `/settings`

**Data fetched:**
- `useConfig()` -- current configuration.
- `useUpdateConfig()` -- mutation.

**State:**
- `autoAccept` (number, default 0.9)
- `review` (number, default 0.7)
- `formats` (string, default "flac, mp3")
- `minBitrate` (number, default 320)
- `concurrency` (number, default 3)
- `validationStrictness` (string, default "moderate")
- `saved` (boolean, false) -- transient "Saved!" indicator

All state fields are synced from server config via `useEffect` when `config` data loads.

**Layout:**

1. **Heading:** `<h2>Settings</h2>`

2. **Matching Thresholds card:**
   - 2-column grid (max-width 500px):
     - **Auto-Accept Threshold:** `<label>` + number input (min 0, max 1, step 0.05).
     - **Review Threshold:** `<label>` + number input (min 0, max 1, step 0.05).

3. **Download Settings card:**
   - Grid (max-width 700px):
     - **Formats:** text input, comma-separated list (e.g., "flac, mp3").
     - **Min Bitrate (kbps):** number input (min 0).
     - **Concurrency:** number input (min 1, max 10).
     - **Validation Strictness:** `<select>` with options: Strict, Moderate, Lenient.

4. **Save button section:**
   - "Save Settings" primary button: calls `handleSave()` which constructs the config object and calls `updateConfig.mutateAsync(...)`. On success, sets `saved = true` for 2 seconds (via `setTimeout`). Disabled while pending.
   - "Saved!" feedback text in accent color, shown for 2 seconds after save.

**Save behavior:**
- Formats string is split by comma, trimmed, and filtered for empty strings before sending.
- Both matching and download sections are sent in a single `updateConfig` call.

---

## Shared Components

### BulkToolbar (`web/src/components/BulkToolbar.tsx`)

**Props:**
```typescript
interface BulkToolbarProps {
  count: number;
  onClear: () => void;
  children?: ReactNode;
}
```

**Behavior:**
- Returns `null` when `count === 0` (component is completely hidden).
- When visible, renders a fixed-position toolbar (`.bulk-toolbar` CSS class) containing:
  - Bold `"{count} selected"` text in small size.
  - "Clear" button calling `onClear`.
  - Any `children` passed through (action buttons from parent).

### useMultiSelect Hook (`web/src/hooks/useMultiSelect.ts`)

```typescript
function useMultiSelect(): {
  selected: Set<string>;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  count: number;
}
```

**Implementation details:**
- `selected` is `useState<Set<string>>(new Set())`.
- `toggle` is `useCallback`: creates new Set, adds or deletes, sets state.
- `selectAll` is `useCallback`: creates new Set from ids array.
- `clear` is `useCallback`: creates empty Set.
- `isSelected` is `useCallback`: `selected.has(id)`, depends on `[selected]`.
- `count` is `useMemo`: `selected.size`, depends on `[selected]`.

---

## Error Handling

- The `request<T>()` function throws on non-2xx responses with the error message from the response body, or a generic `"HTTP {status}"`.
- React Query's `isError` and `error.message` surface these errors in the UI.
- The `QueryClient` staleTime of 30s prevents aggressive refetching while keeping data reasonably fresh.
- Hooks with `refetchInterval` (downloads, jobs, job stats, review stats, spotify auth status) provide near-realtime updates for actively changing data.
- All mutations expose `isError` and `error.message` which are displayed inline in the UI (typically in danger-colored text below the relevant button or form).
- Loading states show muted placeholder text.
- Missing data (playlist/track not found) shows muted "not found" text.

---

## Acceptance Criteria

1. `web/package.json` lists the exact dependencies and versions specified.
2. Vite dev server proxies `/api` to `http://localhost:3100` on port 5173.
3. React root uses `StrictMode`, `QueryClientProvider` with 30s staleTime, and `BrowserRouter`.
4. All 10 routes are defined and nested under the `App` layout.
5. App layout has a fixed 180px sidebar with NavLinks in the documented order. The Review nav item shows a badge with pending review count.
6. All CSS custom properties, component classes, badge variants, button variants, and utility classes are defined as documented.
7. Every API method in the client has the exact path, HTTP method, and TypeScript return type.
8. API client includes review methods (`getReviewPending`, `confirmReview`, `rejectReview`, `bulkConfirmReviews`, `bulkRejectReviews`, `getReviewStats`), bulk-rename, wishlist-run, and track rejections methods.
9. Every React Query hook has the correct queryKey and mutation invalidation pattern. New hooks: `useReviewPending`, `useReviewStats`, `useConfirmReview`, `useRejectReview`, `useBulkConfirmReviews`, `useBulkRejectReviews`, `useBulkRename`, `useWishlistRun`, `useTrackRejections`.
10. Dashboard shows simplified stat cards: playlists, tracks, pending reviews, active downloads, queued jobs. No total duration or library stats.
11. Playlists page supports search, sort, ownership/tag filter, bulk rename with regex pattern + replacement and dry-run preview. No merge, cross-playlist duplicates, or similar names features.
12. Playlist detail shows tags (add/remove), notes (auto-save), sync trigger, push to Spotify with description sync preview. No merge, find-dupes, repair, or statistics cards.
13. Review page shows side-by-side Spotify vs Lexicon comparison for each pending match. Reject button is labeled "Reject & Queue Download". Supports bulk confirm-all and reject-all. Always accessible from sidebar.
14. Track detail shows rejection history (both match rejections and download rejections) in addition to metadata, playlists, matches, downloads, and jobs.
15. Matches page is a read-only browser with status filter (confirm/reject actions moved to Review page).
16. Downloads page includes origin column and "Run Wishlist" button.
17. Queue page type labels reflect renamed job types (`lexicon_match`, `lexicon_tag`, `wishlist_run`).
18. Settings page includes validation strictness setting.
19. `syncEvents()` and `jobEvents()` return `EventSource` instances (not fetch-based).
20. BulkToolbar and useMultiSelect shared components work as documented.
