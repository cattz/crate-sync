# Crate Sync — Product & Technical Specification

> Version: 0.5.0-unreleased | Last updated: 2026-03-19

## 1. Product Overview

### 1.1 Purpose

Crate Sync is a unified tool that bridges Spotify, Lexicon DJ, and Soulseek. Given a Spotify playlist, it:

1. Matches each track against a local Lexicon DJ library
2. Presents uncertain matches for human review
3. Downloads missing tracks from Soulseek
4. Syncs the resulting playlist (with tags) into Lexicon

It also provides playlist management features ported from a prior project (spoty-poty): rename, merge, duplicate detection, bulk operations, and metadata.

### 1.2 Target User

A DJ who curates playlists in Spotify and needs those playlists reflected in Lexicon DJ with high-quality audio files sourced from Soulseek.

### 1.3 Interfaces

The tool provides three interfaces with feature parity:

- **CLI** — primary interface for automation and scripting
- **Web UI** — browser-based dashboard served on localhost
- **API** — RESTful JSON API consumed by both CLI (thin-client mode) and Web UI

### 1.4 Origin Projects

Crate Sync consolidates two prior projects:

- **sldl-python** — Spotify-to-Lexicon sync with Soulseek downloading
- **spoty-poty** — Spotify playlist management (rename, merge, fix duplicates)
- **slsk-batchdl** — reference implementation for Soulseek search techniques (kept for reference only)

---

## 2. Architecture

### 2.1 Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 20 (ESM) |
| Language | TypeScript 5.9 (strict mode) |
| CLI framework | Commander.js |
| HTTP framework | Hono |
| Database | SQLite (better-sqlite3) with WAL journal mode |
| ORM | Drizzle ORM with Drizzle Kit migrations |
| Frontend framework | React 19 |
| Frontend routing | React Router 7 |
| Server state | TanStack React Query 5 |
| Build (CLI) | tsup |
| Build (Web) | Vite 6 |
| Testing | Vitest with @vitest/coverage-v8 |
| Fuzzy search | fuse.js |
| Audio metadata | music-metadata |
| Terminal UI | chalk |

### 2.2 Project Structure

```
crate-sync/
├── src/                          # Backend + CLI
│   ├── index.ts                  # CLI entry point (Commander.js program)
│   ├── config.ts                 # Config loading/saving
│   ├── api/
│   │   ├── server.ts             # Hono app, CORS, static files, SPA fallback
│   │   └── routes/
│   │       ├── playlists.ts      # /api/playlists/*
│   │       ├── tracks.ts         # /api/tracks/*
│   │       ├── matches.ts        # /api/matches/*
│   │       ├── downloads.ts      # /api/downloads/*
│   │       ├── sync.ts           # /api/sync/*
│   │       ├── jobs.ts           # /api/jobs/*
│   │       └── status.ts         # /api/status/*
│   ├── commands/
│   │   ├── auth.ts               # auth login / auth logout
│   │   ├── db.ts                 # db sync / db clear / db export
│   │   ├── playlists.ts          # playlists list/show/rename/delete/merge/fix-duplicates/repair/push
│   │   ├── lexicon.ts            # lexicon list-tracks/create-playlist/sync
│   │   ├── download.ts           # download <track>/list/retry
│   │   ├── matches.ts            # matches list/review/clear
│   │   ├── sync.ts               # sync [playlist] with --all/--dry-run/--verbose/--standalone/--tags
│   │   ├── review.ts             # Interactive terminal match review
│   │   ├── jobs.ts               # jobs list/retry/retry-all/stats + wishlist run
│   │   ├── serve.ts              # serve [--port] [--no-jobs]
│   │   └── status.ts             # status
│   ├── db/
│   │   ├── client.ts             # getDb() singleton, auto-migration, WAL mode
│   │   ├── schema.ts             # Drizzle table definitions (9 tables)
│   │   └── migrations/           # SQL migration files + snapshots
│   ├── services/
│   │   ├── playlist-service.ts   # Local DB playlist operations
│   │   ├── spotify-service.ts    # Spotify Web API client + OAuth
│   │   ├── lexicon-service.ts    # Lexicon DJ REST API client
│   │   ├── soulseek-service.ts   # slskd REST API client
│   │   ├── download-service.ts   # Search, rank, download, validate, move
│   │   └── sync-pipeline.ts      # 3-phase sync orchestration
│   ├── matching/
│   │   ├── types.ts              # MatchStrategy interface, MatchResult, MatchContext
│   │   ├── isrc.ts               # ISRC exact-match strategy
│   │   ├── fuzzy.ts              # Weighted fuzzy matching strategy
│   │   ├── composite.ts          # Runs all strategies, merges results
│   │   ├── normalize.ts          # Text normalization (accents, feat., remix)
│   │   └── index.ts              # createMatcher() factory
│   ├── search/
│   │   └── query-builder.ts      # Multi-strategy search query generation
│   ├── jobs/
│   │   ├── runner.ts             # SQLite polling job runner
│   │   └── handlers/             # Per-type job handlers (7 types)
│   ├── types/
│   │   ├── common.ts             # TrackInfo, MatchResult, SyncPhase, etc.
│   │   ├── spotify.ts            # SpotifyPlaylist, SpotifyTrack
│   │   ├── lexicon.ts            # LexiconTrack, LexiconPlaylist, LexiconTag
│   │   └── soulseek.ts           # SlskdFile, SlskdSearchResult, SlskdTransfer
│   └── utils/
│       ├── logger.ts             # Configurable logger with file output
│       ├── retry.ts              # Exponential backoff with jitter
│       ├── progress.ts           # Terminal progress bar
│       ├── shutdown.ts           # Graceful SIGINT/SIGTERM handling
│       ├── health.ts             # Service connectivity checks
│       └── spotify-url.ts        # Extract playlist ID from Spotify URLs
├── web/                          # Frontend
│   ├── src/
│   │   ├── main.tsx              # React root, Router, QueryClient
│   │   ├── App.tsx               # Layout with sidebar navigation
│   │   ├── api/
│   │   │   ├── client.ts         # fetch wrapper + all API methods + types
│   │   │   └── hooks.ts          # React Query hooks for all operations
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # Stats, service status, auth UIs
│   │   │   ├── Playlists.tsx     # Playlist list with sort/search/filter/bulk
│   │   │   ├── PlaylistDetail.tsx # Tracks, stats, tags, notes, actions
│   │   │   ├── Review.tsx        # Side-by-side match review
│   │   │   ├── Matches.tsx       # Match list with filters
│   │   │   ├── Downloads.tsx     # Download list with status filters
│   │   │   ├── Queue.tsx         # Live job queue with SSE
│   │   │   ├── JobDetail.tsx     # Job detail with children
│   │   │   ├── TrackDetail.tsx   # Full track lifecycle
│   │   │   └── Settings.tsx      # Config editor
│   │   ├── components/
│   │   │   └── BulkToolbar.tsx   # Floating selection toolbar
│   │   ├── hooks/
│   │   │   └── useMultiSelect.ts # Reusable selection state hook
│   │   └── styles/
│   │       └── globals.css       # Dark theme, layout, components
│   └── tsconfig.json
├── data/                         # Runtime data (gitignored)
│   └── crate-sync.db            # SQLite database
├── docs/
│   ├── specs.md                  # This document
│   ├── slskd-api.md             # slskd API reference
│   ├── lexicon-api.md           # Lexicon API reference
│   └── plan-job-queue-query-builder.md
├── .beans/                       # Work tracking (beans format)
├── package.json
├── tsconfig.json
└── CHANGELOG.md
```

### 2.3 Data Flow

```
Spotify API ──→ Local SQLite DB ──→ Lexicon DJ
                     │
                     ├── Matching Engine (ISRC / Fuzzy)
                     │
                     ├── Human Review (CLI or Web)
                     │
                     └── Soulseek (search + download via slskd)
```

### 2.4 Process Model

A single Node.js process runs both the API server and the background job runner:

```
crate-sync serve [--port 3100] [--no-jobs]
  ├── Hono HTTP server
  │   ├── REST API routes
  │   ├── SSE streaming endpoints
  │   └── Static file serving (web/dist/)
  └── Job Runner (in-process polling loop)
      └── Handlers: spotify_sync → match → search → download → validate → lexicon_sync
```

The CLI can operate in two modes:
- **Standalone** — runs the sync pipeline directly (default, or forced with `--standalone`)
- **Thin client** — detects a running server and delegates via API + SSE streaming

---

## 3. Database Schema

All tables use UUID primary keys (generated via `crypto.randomUUID()`). Timestamps are Unix milliseconds stored as integers.

### 3.1 `playlists`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| spotify_id | text | UNIQUE, nullable | Spotify playlist ID |
| name | text | NOT NULL | Playlist name |
| description | text | nullable | Playlist description |
| snapshot_id | text | nullable | Spotify version identifier |
| is_owned | integer | nullable | 1 = user owns it, 0 = followed |
| owner_id | text | nullable | Spotify user ID of the owner |
| owner_name | text | nullable | Display name of the owner |
| tags | text | nullable | JSON string array, e.g. `'["techno","house"]'` |
| notes | text | nullable | Free-form user notes |
| pinned | integer | default 0 | 1 = pinned to top of list |
| last_synced | integer | nullable | Unix ms of last Spotify sync |
| created_at | integer | NOT NULL, default now | |
| updated_at | integer | NOT NULL, auto-update | |

### 3.2 `tracks`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| spotify_id | text | UNIQUE, nullable | Spotify track ID |
| title | text | NOT NULL | |
| artist | text | NOT NULL | Primary artist name |
| album | text | nullable | |
| duration_ms | integer | NOT NULL | Track duration in milliseconds |
| isrc | text | nullable | International Standard Recording Code |
| spotify_uri | text | nullable | `spotify:track:xxxx` URI |
| created_at | integer | NOT NULL | |
| updated_at | integer | NOT NULL | |

### 3.3 `playlist_tracks` (junction)

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| playlist_id | text | FK → playlists.id, NOT NULL | |
| track_id | text | FK → tracks.id, NOT NULL | |
| position | integer | NOT NULL | 0-based order within playlist |
| added_at | integer | nullable | When Spotify reports it was added |
| | | UNIQUE(playlist_id, track_id) | |

### 3.4 `lexicon_tracks`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| file_path | text | UNIQUE, NOT NULL | Path in Lexicon library |
| title | text | NOT NULL | |
| artist | text | NOT NULL | |
| album | text | nullable | |
| duration_ms | integer | nullable | |
| last_synced | integer | NOT NULL | When fetched from Lexicon |

### 3.5 `matches`

Records every attempted match between a source track and a target track.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| source_type | text | NOT NULL | `"spotify"` / `"soulseek"` / `"file"` |
| source_id | text | NOT NULL | Track ID in source system |
| target_type | text | NOT NULL | `"spotify"` / `"lexicon"` / `"soulseek"` |
| target_id | text | NOT NULL | Track ID in target system |
| score | real | NOT NULL | 0.0 – 1.0 similarity score |
| confidence | text | NOT NULL | `"high"` / `"review"` / `"low"` |
| method | text | NOT NULL | `"isrc"` / `"fuzzy"` / `"manual"` |
| status | text | NOT NULL | `"pending"` / `"confirmed"` / `"rejected"` |
| created_at | integer | NOT NULL | |
| updated_at | integer | NOT NULL | |
| | | UNIQUE(source_type, source_id, target_type, target_id) | |

### 3.6 `downloads`

Tracks the full lifecycle of a Soulseek download.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| track_id | text | FK → tracks.id, NOT NULL | |
| playlist_id | text | FK → playlists.id, nullable | |
| status | text | NOT NULL | See status enum below |
| soulseek_path | text | nullable | Source path on Soulseek |
| file_path | text | nullable | Final local file path |
| error | text | nullable | Error message if failed |
| started_at | integer | nullable | |
| completed_at | integer | nullable | |
| created_at | integer | NOT NULL | |

**Download status enum:** `pending` → `searching` → `downloading` → `validating` → `moving` → `done` | `failed`

### 3.7 `jobs`

Background job queue with SQLite polling.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| type | text | NOT NULL | See job types below |
| status | text | NOT NULL | `"queued"` / `"running"` / `"done"` / `"failed"` |
| priority | integer | default 0 | Higher = processed first |
| payload | text | nullable | JSON-serialized input data |
| result | text | nullable | JSON-serialized output data |
| error | text | nullable | Error message if failed |
| attempt | integer | default 0 | Current attempt number |
| max_attempts | integer | default 3 | |
| run_after | integer | nullable | Don't process before this timestamp |
| parent_job_id | text | nullable | FK → jobs.id for hierarchies |
| started_at | integer | nullable | |
| completed_at | integer | nullable | |
| created_at | integer | NOT NULL | |

**Job types:** `spotify_sync`, `match`, `search`, `download`, `validate`, `lexicon_sync`, `wishlist_scan`

### 3.8 `sync_log`

Audit trail for sync operations.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| playlist_id | text | FK → playlists.id, nullable | |
| action | text | NOT NULL | What happened |
| details | text | nullable | Additional context |
| created_at | integer | NOT NULL | |

---

## 4. Configuration

**Location:** `~/.config/crate-sync/config.json`

```jsonc
{
  "spotify": {
    "clientId": "",                    // Spotify Developer App client ID
    "clientSecret": "",                // Spotify Developer App client secret
    "redirectUri": "http://127.0.0.1:8888/callback"
  },
  "lexicon": {
    "url": "http://localhost:48624",   // Lexicon DJ API base URL
    "downloadRoot": ""                 // Path where downloads are moved (e.g. /Music/Incoming)
  },
  "soulseek": {
    "slskdUrl": "http://localhost:5030",  // slskd API base URL
    "slskdApiKey": "",                    // slskd API key
    "searchDelayMs": 5000,                // Delay between search requests
    "downloadDir": ""                     // slskd download directory (host path)
  },
  "matching": {
    "autoAcceptThreshold": 0.9,        // Score >= this → auto-confirmed
    "reviewThreshold": 0.7             // Score >= this → needs human review
  },
  "download": {
    "formats": ["flac", "mp3"],        // Accepted audio formats
    "minBitrate": 320,                 // Minimum bitrate filter
    "concurrency": 3                   // Parallel downloads
  },
  "jobRunner": {
    "pollIntervalMs": 1000,            // How often to check for new jobs
    "wishlistIntervalMs": 21600000     // Wishlist scan interval (6 hours)
  }
}
```

**Token storage:** `~/.config/crate-sync/spotify-tokens.json` (auto-managed)

---

## 5. Matching Engine

### 5.1 Strategy Architecture

The matching engine uses a pluggable strategy pattern:

```
CompositeMatchStrategy
├── IsrcMatchStrategy     (exact ISRC code comparison)
└── FuzzyMatchStrategy    (weighted multi-field similarity)
```

The composite runs all strategies. If any returns "high" confidence, it returns immediately. Otherwise, it merges results keeping the best score per candidate.

### 5.2 ISRC Strategy

- Compares ISRC codes directly
- Score = 1.0 if match, no result otherwise
- Confidence = "high" (always)

### 5.3 Fuzzy Strategy

**Algorithms:**

| Algorithm | Description |
|-----------|-------------|
| Jaccard Similarity | Word-level set overlap: \|intersection\| / \|union\| |
| Damerau-Levenshtein | Edit distance supporting insertions, deletions, substitutions, transpositions |
| Edit Similarity | 1 - (edit_distance / max_length) |
| String Similarity | max(Jaccard, Edit) |
| Artist Similarity | String similarity, but floors at 0.7 if one name contains the other (handles "feat." cases) |
| Duration Similarity | 1 - (diff_ms / 30000)^1.5 — smooth power decay |

**Text Normalization (applied before comparison):**

- Base: lowercase, strip accents/diacritics, remove symbols
- Artist: additionally remove "(feat. ...)", "& others", "the " prefix
- Title: remove remix/edition/remaster suffixes in parentheses/brackets

**Weight Profiles by Context:**

| Context | Title | Artist | Album | Duration |
|---------|-------|--------|-------|----------|
| Lexicon matching | 0.30 | 0.30 | 0.15 | 0.25 |
| Soulseek search | 0.30 | 0.25 | 0.10 | 0.35 |
| Post-download validation | 0.30 | 0.30 | 0.15 | 0.25 |

**Confidence Assignment:**

- score >= `autoAcceptThreshold` (default 0.9) → `"high"` (auto-confirmed)
- score >= `reviewThreshold` (default 0.7) → `"review"` (human review required)
- score < `reviewThreshold` → `"low"` (rejected / not found)

### 5.4 Match Persistence Rules

- Upsert by (source_type, source_id, target_type, target_id) — deduplicated
- Never downgrade a confirmed match (if re-running match phase on a playlist, previously confirmed matches are reused)
- Rejected matches are remembered and skipped in future runs

---

## 6. Search System

### 6.1 Multi-Strategy Query Builder

`generateSearchQueries(track)` produces up to 4 search strategies, tried in order until one returns results:

| # | Strategy | Example Input | Example Query |
|---|----------|--------------|---------------|
| 1 | Full | "Reliquia - German Brigante Remix" by "Ivory" | `"Ivory Reliquia German Brigante Remix"` |
| 2 | Base-Title | same | `"Ivory Reliquia"` (remix suffix stripped) |
| 3 | Title-Only | same | `"Reliquia German Brigante Remix"` |
| 4 | Keywords | same | `"Ivory Reliquia German"` (first 2 significant words) |

**Cleaning rules:**
- Replace `" - "` with space
- Remove all parenthetical content: `(Remix)`, `(feat. X)`, `(Extended Mix)`
- Remove bracket content: `[...]`
- Collapse multiple spaces

**Significant words:** words > 2 characters; falls back to all words if fewer than requested.

### 6.2 Result Ranking

After search, results are filtered and ranked:
1. **Format filter** — only accepted formats (default: flac, mp3)
2. **Bitrate filter** — minimum bitrate (default: 320 kbps)
3. **Fuzzy match** — score results against track metadata using the matching engine
4. **Sort** — by match score descending

---

## 7. Sync Pipeline

The core workflow is a 3-phase pipeline:

### Phase 1: Match

1. Fetch all tracks for the target playlist from local DB
2. Load entire Lexicon library (paginated, 1000 tracks/page)
3. For each track, reuse any existing confirmed match
4. For unmatched tracks, run matching engine (ISRC → Fuzzy composite)
5. Categorize results:
   - **found** — high confidence, auto-confirmed
   - **needsReview** — review confidence, requires human decision
   - **notFound** — low/no match, candidate for download
6. Persist all matches to DB

**Output:** `{ playlistName, found[], needsReview[], notFound[], total }`

### Phase 2: Review

1. Present `needsReview` items to user (CLI interactive prompt or Web UI)
2. User accepts or rejects each match
3. Update match status in DB
4. Accepted matches move to "found"; rejected move to "notFound" (download candidates)

**Output:** `{ confirmed, missing }`

### Phase 3: Download + Lexicon Sync

1. For each missing track, search Soulseek using multi-strategy query builder
2. Rank and filter results
3. Download best candidate
4. Validate audio metadata (title/artist match, format, bitrate)
5. Move file to `lexicon.downloadRoot/{playlistName}/`
6. Create/update Lexicon playlist with all confirmed track IDs
7. Sync tags based on Spotify playlist name segments (e.g., "House / Tech / Berlin" → 3 tags under a "crate-sync" category)

---

## 8. Job Queue

### 8.1 Design

SQLite-polled job queue running in-process alongside the Hono server. Designed so migration to a message broker (BullMQ/Redis) is straightforward — all handlers stay identical.

### 8.2 Job Lifecycle

```
queued ──→ running ──→ done
                  └──→ failed ──→ (re-queued with backoff) ──→ queued
```

**Atomic claiming:** `UPDATE jobs SET status='running' WHERE id=? AND status='queued'` prevents double-processing.

**Exponential backoff:** `2^attempt * 1000` ms. Configurable max attempts (default 3).

### 8.3 Job Handlers

| Type | Behavior | Creates Children |
|------|----------|-----------------|
| `spotify_sync` | Fetch playlist from Spotify, upsert to DB | → `match` |
| `match` | Run `SyncPipeline.matchPlaylist()` | → `search` (for each notFound) |
| `search` | Multi-strategy Soulseek search + ranking | → `download` (if results found) |
| `download` | Download file, validate, move to Lexicon folder | (none) |
| `validate` | Post-download metadata validation | (none) |
| `lexicon_sync` | Create/update Lexicon playlist + sync tags | (none) |
| `wishlist_scan` | Re-queue failed searches past cooldown | → `search` |

### 8.4 Wishlist

Automatic retry system for failed searches:
- Scans for failed search/download jobs past their cooldown period
- Re-queues with the next query strategy
- Backoff schedule: 1h → 6h → 24h → 7d → skip
- Runs on a configurable interval (default: 6 hours)
- Can be triggered manually via `crate-sync wishlist run`

### 8.5 Event System

Job state changes emit events via an in-memory listener set, consumed by:
- SSE endpoint (`GET /api/jobs/stream`) for Web UI real-time updates
- CLI thin-client mode for terminal progress display

---

## 9. External Service Integrations

### 9.1 Spotify Web API

**Authentication:** OAuth 2.0 Authorization Code flow

**Scopes:** `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, `playlist-modify-private`, `user-library-read`

**Token management:** Stored in `~/.config/crate-sync/spotify-tokens.json`, auto-refreshed 60s before expiry.

**Operations:**
- Get all user playlists (paginated)
- Get playlist tracks (paginated)
- Sync playlists + tracks to local DB (upsert by spotify_id)
- Rename playlist
- Add/remove tracks (batched in groups of 100)
- Replace all tracks

### 9.2 Lexicon DJ API

**Base URL:** Configurable (default `http://localhost:48624`)

**Operations:**
- Ping (connectivity check)
- Get all tracks (paginated, 1000/page)
- Get playlist by name (recursive tree traversal)
- Create playlist with track IDs
- Set playlist tracks (replace all)
- Get/create tag categories and tags
- Get/update track tags

**Response unwrapping:** Handles multiple wrapper formats (data, content, direct array).

### 9.3 Soulseek (via slskd)

**Base URL:** Configurable (default `http://localhost:5030`)

**Authentication:** API key header

**Operations:**
- Ping (connectivity check)
- Start search (non-blocking, returns search ID)
- Get search results (with status polling)
- Wait for search completion (result stabilization: waits for count to stop changing for 4 seconds, minimum 10s)
- Initiate file download
- Monitor transfers
- Cancel transfers

---

## 10. CLI Commands

### 10.1 Global

```
crate-sync [--debug] <command>
```

`--debug` enables file logging to `./data/crate-sync.log`

### 10.2 Authentication

```
crate-sync auth login       # Spotify OAuth flow (opens browser)
crate-sync auth logout      # Clear stored tokens
```

### 10.3 Database

```
crate-sync db sync           # Sync all playlists from Spotify → local DB
crate-sync db clear          # Delete all data
crate-sync db export         # Export to JSON
```

### 10.4 Playlists

```
crate-sync playlists list                        # List all with track counts + IDs
crate-sync playlists show <id>                   # Show details + tracks
crate-sync playlists rename <id> <name> [--push] # Rename (optionally push to Spotify)
crate-sync playlists delete <id> [--spotify]     # Delete (optionally unfollow on Spotify)
crate-sync playlists merge <target> <source...>  # Merge tracks (dedup by track_id)
crate-sync playlists fix-duplicates <id>         # Remove duplicate tracks
crate-sync playlists repair <id> [--download]    # Re-match against Lexicon
crate-sync playlists push [id] [--all]           # Push local changes to Spotify
```

Playlist ID accepts: UUID, Spotify ID, Spotify URL, or exact name.

### 10.5 Sync

```
crate-sync sync [playlist] [--all] [--dry-run] [--verbose] [--tags] [--standalone] [--server <url>]
```

- `--dry-run` — Phase 1 only (match report, no downloads)
- `--verbose` — Per-track search diagnostics
- `--tags` — Sync Lexicon tags from playlist name segments
- `--standalone` — Force local pipeline (don't use running server)
- `--server <url>` — Connect to specific server

### 10.6 Review

```
crate-sync review            # Interactive terminal review of pending matches
```

Shows side-by-side Spotify vs Lexicon track info. Supports: y(es), n(o), a(ll), q(uit), s(kip).

### 10.7 Jobs

```
crate-sync jobs list [--status <status>] [--type <type>]
crate-sync jobs retry <id>
crate-sync jobs retry-all [--type <type>]
crate-sync jobs stats
crate-sync wishlist run      # Manual wishlist scan trigger
```

### 10.8 Server

```
crate-sync serve [--port 3100] [--no-jobs]
```

Starts HTTP API + Web UI + job runner. `--no-jobs` disables the background runner.

### 10.9 Status

```
crate-sync status            # Check connectivity to Spotify, Lexicon, Soulseek, DB
```

---

## 11. REST API

Base URL: `/api`

### 11.1 Status & Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Health check for all services + DB stats |
| GET | `/status/config` | Non-sensitive configuration |
| PUT | `/status/config` | Update matching/download config |
| POST | `/status/spotify/login` | Initiate Spotify OAuth |
| GET | `/status/spotify/auth-status` | Check OAuth completion |
| DELETE | `/status/spotify/login` | Clear Spotify tokens |
| PUT | `/status/soulseek/connect` | Save + test slskd credentials |
| DELETE | `/status/soulseek/connect` | Clear slskd credentials |

### 11.2 Playlists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/playlists` | List all playlists with track counts |
| POST | `/playlists/sync` | Sync all from Spotify → `{added, updated, unchanged}` |
| GET | `/playlists/duplicates` | Cross-playlist duplicate tracks |
| GET | `/playlists/similar?threshold=0.7` | Playlist name similarity pairs |
| GET | `/playlists/stats` | Library stats: total playlists, tracks, duration |
| POST | `/playlists/bulk-rename` | Batch rename with dry-run preview |
| GET | `/playlists/:id` | Playlist detail with trackCount + totalDurationMs |
| PATCH | `/playlists/:id` | Update metadata (tags, notes, pinned) |
| PUT | `/playlists/:id/rename` | Rename playlist |
| DELETE | `/playlists/:id` | Delete playlist + junction entries |
| POST | `/playlists/:id/push` | Push local changes to Spotify |
| POST | `/playlists/:id/repair` | Run Phase 1 matching only |
| POST | `/playlists/:id/merge` | Merge tracks from source playlists |
| GET | `/playlists/:id/tracks` | Get tracks ordered by position |
| GET | `/playlists/:id/duplicates` | Within-playlist duplicates |

**Route ordering note:** Static segments (`/sync`, `/duplicates`, `/similar`, `/stats`, `/bulk-rename`) must be registered before parameterized `/:id` routes in Hono.

### 11.3 Tracks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tracks?q=&limit=&offset=` | Search/list tracks |
| GET | `/tracks/:id` | Track details |
| GET | `/tracks/:id/lifecycle` | Full lifecycle (playlists, matches, downloads, jobs) |

### 11.4 Matches

| Method | Path | Description |
|--------|------|-------------|
| GET | `/matches?status=` | List matches (enriched with source + target tracks) |
| PUT | `/matches/:id` | Update match status (confirmed/rejected) |

### 11.5 Downloads

| Method | Path | Description |
|--------|------|-------------|
| GET | `/downloads?status=&playlistId=` | List downloads (enriched with track info) |
| GET | `/downloads/:id` | Download detail |

### 11.6 Sync

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/:playlistId` | Start sync → `{syncId, jobId}` |
| POST | `/sync/:playlistId/dry-run` | Phase 1 only → `PhaseOneResult` |
| GET | `/sync/:syncId/events` | SSE stream (phase, match-complete, review-needed, download-progress, sync-complete, error) |
| POST | `/sync/:syncId/review` | Submit match review decisions |
| GET | `/sync/:syncId` | Sync session status |

### 11.7 Jobs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/jobs?type=&status=&limit=&offset=` | List with pagination |
| GET | `/jobs/stats` | Counts by status and type |
| GET | `/jobs/stream` | SSE stream (job-running, job-done, job-failed, job-requeued) |
| GET | `/jobs/:id` | Detail with child jobs |
| POST | `/jobs/:id/retry` | Re-queue failed job |
| DELETE | `/jobs/:id` | Cancel queued job |
| POST | `/jobs/retry-all` | Re-queue all failed (optionally by type) |

---

## 12. Web UI

### 12.1 Design System

Dark theme inspired by Spotify:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | #0f0f0f | Page background |
| `--bg-card` | #1a1a1a | Card/sidebar background |
| `--bg-hover` | #252525 | Row/button hover |
| `--border` | #2a2a2a | All borders |
| `--text` | #e0e0e0 | Primary text |
| `--text-muted` | #888 | Secondary text |
| `--accent` | #1db954 | Primary actions (Spotify green) |
| `--danger` | #e74c3c | Destructive actions |
| `--warning` | #f39c12 | Warnings/review |
| `--info` | #3498db | Informational badges |
| `--radius` | 8px | Border radius |

**Layout:** Fixed 180px sidebar + flexible content area. Card-based sections. All tables have hover highlighting, muted column headers, and monospace font for durations.

**Components:** `.card`, `.badge` (green/yellow/red/blue/gray), `.stat-card`, `.grid-stats`, `.progress-bar`, `.modal-overlay` + `.modal`, `.bulk-toolbar`

### 12.2 Pages

**Dashboard** (`/`)
- Stat cards: playlists, tracks, total duration, pending matches, active downloads, queued jobs
- Service status table (Spotify, Lexicon, Soulseek, Database) with OK/error indicators
- Spotify auth widget (login/logout with OAuth flow)
- Soulseek connection widget (URL + API key)

**Playlists** (`/playlists`)
- Sortable table (Name, Tracks, Owner, Last Synced) with ▲/▼ indicators
- Search bar (case-insensitive substring on name)
- Ownership filter toggle (All / Own / Followed)
- Tag filter dropdown (populated from all existing tags)
- Pinned playlists sort to top
- Tag badges and pin indicators on rows
- Per-row actions: View, Rename (modal), Delete (confirmation modal)
- Checkbox multi-select with select-all and indeterminate state
- Floating bulk toolbar: Delete Selected, Merge Selected
- "Sync from Spotify" button with result summary
- "Cross-Playlist Dupes" toggle with results table
- "Similar Names" toggle with similarity pairs and merge buttons
- "Bulk Rename" button → modal with mode selector (find-replace / prefix / suffix), dry-run preview, apply

**Playlist Detail** (`/playlists/:id`)
- Header: back link, playlist name, track count
- Pin/Unpin toggle button
- Action buttons: Start Sync, Push to Spotify, Repair, Find Dupes, Merge Into, Rename, Delete
- Stat cards: Tracks, Duration, Artists, Top Artist
- Tags card: badge list with click-to-remove, add input with autocomplete suggestions
- Notes card: textarea with save-on-blur
- Duplicates panel (toggle)
- Sync progress (SSE events)
- Review panel for pending matches
- Track table: sortable (#, Title, Artist, Album, Duration), search/filter bar, total duration summary, clickable rows → TrackDetail

**Review** (`/review`)
- Side-by-side Spotify vs Lexicon comparison cards
- Fields: title, artist, album, duration, ISRC, file path
- Score badge with percentage
- Per-match: Confirm / Reject buttons
- Bulk: Confirm All / Reject All

**Matches** (`/matches`)
- Status filter (all / pending / confirmed / rejected)
- Table with source track, target track, score, confidence, status, actions

**Downloads** (`/downloads`)
- Status filter
- Table with track info, status badge, file path, error, timestamps
- Real-time updates (5s polling)

**Queue** (`/queue`)
- Stat cards by status (queued, running, done, failed)
- Type/status filters
- Live job table with SSE streaming
- Per-job: Retry / Cancel buttons
- Retry All Failed button
- Drill-down to Job Detail

**Job Detail** (`/queue/:id`)
- Full job info: type, status, priority, attempt/maxAttempts
- Payload and result as formatted JSON
- Error message if failed
- Child jobs list
- Parent job link
- Retry / Cancel buttons

**Track Detail** (`/tracks/:id`)
- Spotify metadata (title, artist, album, duration, ISRC, URI)
- Playlist membership list
- Match history (all matches with status, score, method)
- Download history (status, file path, errors)
- Related jobs (found via json_extract on payload)

**Settings** (`/settings`)
- Matching thresholds editor (auto-accept, review)
- Download config (formats, min bitrate, concurrency)
- Service credentials (Spotify, Soulseek)

### 12.3 Frontend Architecture

- **API Client** (`web/src/api/client.ts`) — typed `fetch` wrapper with error handling. All methods return typed promises. EventSource for SSE.
- **React Query Hooks** (`web/src/api/hooks.ts`) — one hook per API operation. useQuery for reads, useMutation for writes. Automatic cache invalidation on mutations. 30s default stale time.
- **Reusable Hooks** — `useMultiSelect` (selection state management)
- **Reusable Components** — `BulkToolbar` (floating selection actions bar)

### 12.4 Routes

```
/                → Dashboard
/playlists       → Playlists
/playlists/:id   → PlaylistDetail
/review          → Review
/matches         → Matches
/downloads       → Downloads
/queue           → Queue
/queue/:id       → JobDetail
/tracks/:id      → TrackDetail
/settings        → Settings
```

---

## 13. Services

### 13.1 PlaylistService

Local database operations for playlists and tracks. Stateless — takes a DB instance in constructor.

| Method | Signature | Description |
|--------|-----------|-------------|
| getPlaylists | `(): Playlist[]` | All playlists |
| getPlaylist | `(id: string): Playlist \| null` | By UUID, spotify_id, Spotify URL, or exact name |
| getPlaylistTracks | `(playlistId: string): (Track & {position})[]` | Ordered by position |
| findDuplicatesInPlaylist | `(playlistId): {track, duplicates}[]` | Groups by spotify_id, then title+artist |
| findDuplicatesAcrossPlaylists | `(): {track, playlists}[]` | Tracks appearing in 2+ playlists |
| createPlaylist | `(name): Playlist` | Local-only (no spotify_id) |
| upsertPlaylist | `(data): Playlist` | Insert or update by spotify_id |
| upsertTrack | `(data): Track` | Insert or update by spotify_id |
| setPlaylistTracks | `(playlistId, trackIds, addedAt?): void` | Replace all entries |
| renamePlaylist | `(playlistId, newName): void` | |
| mergePlaylistTracks | `(targetId, sourceIds): {added, duplicatesSkipped}` | Dedup by track_id |
| removePlaylist | `(playlistId): void` | Deletes junction entries first |
| getPlaylistDiff | `(playlistId, spotifyTracks): {toAdd, toRemove, renamed}` | Compare local vs Spotify by URI |
| updateSnapshotId | `(playlistId, snapshotId): void` | |

### 13.2 SpotifyService

Spotify Web API client with OAuth token management.

| Method | Description |
|--------|-------------|
| getAuthUrl(state) | Generate OAuth authorization URL |
| exchangeCode(code) | Exchange auth code for tokens |
| isAuthenticated() | Check validity + auto-refresh |
| getPlaylists() | All user playlists (paginated) |
| getPlaylistTracks(playlistId) | All tracks in a playlist |
| syncToDb() | Upsert all playlists + tracks to local DB. Returns {added, updated, unchanged} |
| renamePlaylist(spotifyId, name) | PUT to Spotify API |
| addTracksToPlaylist(spotifyId, uris) | Batched (100/request) |
| removeTracksFromPlaylist(spotifyId, uris) | Batched |
| replacePlaylistTracks(spotifyId, uris) | PUT first 100, POST remaining |
| deletePlaylist(spotifyId) | Unfollow |
| createPlaylist(name, description?, isPublic?) | |

### 13.3 LexiconService

Lexicon DJ REST API client.

| Method | Description |
|--------|-------------|
| ping() | Test connectivity |
| getTracks() | All tracks (paginated 1000/page) |
| searchTracks(query) | Client-side filtering (no server search) |
| getPlaylistByName(name) | Recursive tree traversal |
| createPlaylist(name, trackIds) | |
| setPlaylistTracks(playlistId, trackIds) | Replace all |
| getTags() | All categories + tags |
| createTagCategory(label, color) | |
| createTag(categoryId, label) | |
| getTrackTags(trackId) | |
| updateTrackTags(trackId, tagIds) | |

### 13.4 SoulseekService

slskd REST API wrapper.

| Method | Description |
|--------|-------------|
| ping() | Test connectivity |
| search(query) | Blocking search with result stabilization |
| startSearch(query) | Non-blocking, returns search ID |
| getSearchResults(searchId) | Raw results |
| waitForSearch(searchId) | Polls until stable (4s no change, 10s minimum) |
| download(username, filename, targetPath) | |
| getTransfers() | |
| cancelTransfer(transferId) | |

### 13.5 DownloadService

Search, rank, download, validate, and move audio files.

| Method | Description |
|--------|-------------|
| rankResults(files) | Filter by format/bitrate, rank by fuzzy match score |
| downloadBatch(items, onProgress, onReview) | Full pipeline per track using query builder |
| ensurePlaylistFolder(name) | Create `downloadRoot/name/` if needed |

### 13.6 SyncPipeline

3-phase sync orchestrator. Accepts dependency injection for testing.

| Method | Description |
|--------|-------------|
| matchPlaylist(playlistId) | Phase 1: Match all tracks → {found, needsReview, notFound} |
| applyReviewDecisions(syncId, decisions) | Phase 2: Apply user decisions |
| downloadMissing(syncId, items, onProgress) | Phase 3: Download + validate + move |
| syncToLexicon(playlistId) | Phase 3b: Create/update Lexicon playlist + tags |

---

## 14. Utilities

| Utility | File | Description |
|---------|------|-------------|
| Logger | `src/utils/logger.ts` | Configurable log level, optional file output, per-module namespaces |
| Retry | `src/utils/retry.ts` | `withRetry()` — exponential backoff with jitter, max 3 retries, retries on network errors and 5xx/429 |
| Progress | `src/utils/progress.ts` | Terminal progress bar (overwriting line), tracks completed/total |
| Shutdown | `src/utils/shutdown.ts` | Graceful SIGINT/SIGTERM handler with cleanup callbacks |
| Health | `src/utils/health.ts` | Service connectivity checks (Spotify, Lexicon, Soulseek, DB) |
| Spotify URL | `src/utils/spotify-url.ts` | `extractPlaylistId()` — extracts ID from full Spotify URLs or passes through bare IDs |

---

## 15. Build & Deployment

### 15.1 Scripts

```bash
pnpm dev <args>        # Run CLI in development (tsx)
pnpm dev serve         # Start dev server
pnpm build             # Build CLI (tsup) + Web (vite)
pnpm test              # Run vitest
pnpm test:coverage     # Run with coverage
```

### 15.2 Build Output

- **CLI:** `dist/index.js` (ESM, shebang `#!/usr/bin/env node`)
- **Web:** `web/dist/` (SPA with router)
- Server serves `web/dist/` as static files with SPA fallback

### 15.3 Runtime

- Single Node.js process
- SQLite database at `./data/crate-sync.db` (WAL mode)
- Config at `~/.config/crate-sync/config.json`
- Tokens at `~/.config/crate-sync/spotify-tokens.json`

---

## 16. Testing

**Framework:** Vitest with @vitest/coverage-v8

**Test suites:**

| Area | Tests | Description |
|------|-------|-------------|
| Matching engine | ~17 tests | ISRC, fuzzy, composite, normalization |
| Query builder | ~12 tests | Remixes, unicode, parentheses, edge cases |
| Services | Unit tests | PlaylistService, DownloadService with mocked DB/APIs |
| Sync pipeline | Integration | 3-phase pipeline with mocked Lexicon/Soulseek |
| Utilities | Unit tests | Spotify URL extraction, retry logic |

---

## 17. Known Issues / Remaining Work

From the active beans backlog:

| ID | Priority | Title | Status |
|----|----------|-------|--------|
| bg02 | high | Duplicate downloads from Soulseek | todo |
| bg03 | normal | Review UI side-by-side track comparison (improvement) | todo |
| bg04 | normal | Allow sort by columns in Review page | todo |

---

## 18. Version History

| Version | Date | Highlights |
|---------|------|-----------|
| 0.1.0 | 2026-03-09 | Initial CLI: auth, db, playlists, matching, 3-phase sync, download |
| 0.2.0 | 2026-03-10 | Lexicon API fixes, push to Spotify, repair, health checks, retry, progress, graceful shutdown |
| 0.3.0 | 2026-03-15 | Web UI (Hono + React), improved matching (Damerau-Levenshtein, normalization, context weights) |
| 0.4.0 | 2026-03-17 | Multi-strategy query builder, job queue with SQLite polling, wishlist, queue/review/track pages, CLI thin client |
| 0.5.0 | unreleased | Web UI playlist management: sort/search/filter, ownership, rename/delete, push/repair, merge, duplicates, track enhancements, multi-select/bulk, similarity suggestions, bulk rename, statistics, metadata (tags/notes/pinning) |
