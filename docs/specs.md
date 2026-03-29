# Crate Sync — Product & Technical Specification

> Version: 0.6.0-unreleased | Last updated: 2026-03-28

## 1. Product Overview

### 1.1 Purpose

Crate Sync bridges Spotify, Lexicon DJ, and Soulseek. Given a Spotify playlist, it:

1. Matches each track against a local Lexicon DJ library
2. Tags confirmed matches immediately in Lexicon under a configurable category
3. Parks uncertain matches for async human review (accessible anytime)
4. Downloads missing tracks from Soulseek (triggered by no-match or review rejection)

It also provides playlist management: rename, bulk rename, push to Spotify (including description sync of tags + notes), and local metadata (tags, notes, pinning).

### 1.2 Key Behavioral Principles

- **Non-blocking sync** — the pipeline matches, tags, and exits. Review happens asynchronously, not as a gate.
- **Tags, not playlists** — Lexicon integration uses category-scoped tags only. No Lexicon playlists are created or managed.
- **Rejection memory** — false matches (both Lexicon and Soulseek) are persisted and never repeated.
- **Manual wishlist** — failed downloads stay failed until explicitly re-queued via `wishlist run`.
- **Description sync** — playlist tags and notes are serialized and pushed to Spotify's description field.

### 1.3 Target User

A DJ who curates playlists in Spotify and needs those playlists reflected in Lexicon DJ with high-quality audio files sourced from Soulseek.

### 1.4 Interfaces

Three interfaces with feature parity:

- **CLI** — primary interface for automation and scripting
- **Web UI** — browser-based dashboard served on localhost
- **REST API** — JSON API consumed by both CLI (thin-client mode) and Web UI

### 1.5 Origin Projects

Crate Sync consolidates two prior projects:

- **sldl-python** — Spotify-to-Lexicon sync with Soulseek downloading
- **spoty-poty** — Spotify playlist management (rename, bulk operations)
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
│   │   ├── state.ts              # In-memory sync session state
│   │   └── routes/
│   │       ├── playlists.ts      # /api/playlists/*
│   │       ├── tracks.ts         # /api/tracks/*
│   │       ├── matches.ts        # /api/matches/*
│   │       ├── downloads.ts      # /api/downloads/*
│   │       ├── sync.ts           # /api/sync/*
│   │       ├── review.ts         # /api/review/*
│   │       ├── jobs.ts           # /api/jobs/*
│   │       └── status.ts         # /api/status/*
│   ├── commands/
│   │   ├── auth.ts               # auth login / auth status
│   │   ├── db.ts                 # db sync / db status
│   │   ├── playlists.ts          # playlists list/show/rename/bulk-rename/delete/push
│   │   ├── lexicon.ts            # lexicon status / lexicon match
│   │   ├── matches.ts            # matches list/confirm/reject
│   │   ├── review.ts             # review list/confirm/reject/bulk-confirm/bulk-reject
│   │   ├── sync.ts               # sync [playlist] (non-blocking)
│   │   ├── jobs.ts               # jobs list/retry/retry-all/stats
│   │   ├── wishlist.ts           # wishlist run
│   │   ├── serve.ts              # serve [--port] [--no-jobs]
│   │   └── status.ts             # status
│   ├── db/
│   │   ├── client.ts             # getDb() singleton, auto-migration, WAL mode
│   │   ├── schema.ts             # Drizzle table definitions (9 tables)
│   │   └── migrations/           # SQL migration files + snapshots
│   ├── services/
│   │   ├── playlist-service.ts   # Local DB playlist CRUD + bulk rename
│   │   ├── spotify-service.ts    # Spotify Web API client + OAuth
│   │   ├── spotify-push.ts       # Local-to-Spotify push orchestration
│   │   ├── lexicon-service.ts    # Lexicon DJ REST API client (tags only, no playlists)
│   │   ├── soulseek-service.ts   # slskd REST API client
│   │   ├── download-pipeline.ts  # Pipeline-only: search, rank, download, validate, move
│   │   ├── sync-pipeline.ts      # Match + tag orchestration (non-blocking)
│   │   └── review-service.ts     # Async review queue (confirm/reject/bulk)
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
│   │   ├── common.ts             # TrackInfo, MatchResult, ReviewStatus, etc.
│   │   ├── spotify.ts            # SpotifyPlaylist, SpotifyTrack
│   │   ├── lexicon.ts            # LexiconTrack, LexiconTagCategory, LexiconTag
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
│   │   │   ├── PlaylistDetail.tsx # Tracks, tags, notes, sync, push, description preview
│   │   │   ├── Review.tsx        # Async review queue with badge count
│   │   │   ├── Matches.tsx       # Match list with filters
│   │   │   ├── Downloads.tsx     # Download list with status filters
│   │   │   ├── Queue.tsx         # Live job queue with SSE
│   │   │   ├── JobDetail.tsx     # Job detail with children
│   │   │   ├── TrackDetail.tsx   # Full track lifecycle + rejection history
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
│   ├── track-lifecycle.mmd      # Track lifecycle state diagram
│   ├── slskd-api.md             # slskd API reference
│   ├── lexicon-api.md           # Lexicon API reference
│   └── plan-job-queue-query-builder.md
├── .beans/                       # Work tracking (beans format) + detailed specs
├── package.json
├── tsconfig.json
└── CHANGELOG.md
```

### 2.3 Data Flow

```
Spotify API ──→ Local SQLite DB ──→ Lexicon DJ (tags only)
                     │
                     ├── Matching Engine (ISRC / Fuzzy)
                     │
                     ├── Async Review Queue (park → confirm/reject)
                     │
                     └── Soulseek (search + download via slskd)
```

### 2.4 Functional Groups

The system is organized into 3 independent functional groups:

```
Group 1: Spotify Sync & Playlist Management
    ├── Spotify OAuth + API client
    ├── Local DB CRUD (list, rename, bulk-rename, delete, metadata)
    └── Push to Spotify (renames, track changes, description sync)

Group 2: Lexicon Matching & Tagging
    ├── Matching engine (ISRC + Fuzzy composite)
    ├── Lexicon service (tags only, category-scoped)
    ├── Sync pipeline (match → tag confirmed → park pending → return not-found)
    └── Review service (async confirm/reject, rejection → download queue)

Group 3: Download Pipeline
    ├── Search query builder (4 strategies)
    ├── Soulseek service (slskd client)
    └── Download pipeline (search → rank → download → validate → move)
```

**Dependency:** Group 1 → Group 2 → Group 3

### 2.5 Process Model

A single Node.js process runs both the API server and the background job runner:

```
crate-sync serve [--port 3100] [--no-jobs]
  ├── Hono HTTP server
  │   ├── REST API routes (8 modules)
  │   ├── SSE streaming endpoints
  │   └── Static file serving (web/dist/)
  └── Job Runner (in-process polling loop)
      └── Handlers: spotify_sync → lexicon_match → search → download → validate → lexicon_tag
```

The CLI can operate in two modes:
- **Standalone** — runs the sync pipeline directly (default)
- **Thin client** — detects a running server and delegates via API + SSE streaming

---

## 3. Functional Groups

### 3.1 Group 1: Spotify Sync & Playlist Management

**Scope:** Everything related to Spotify data and local playlist management.

**Features:**
- Spotify OAuth authentication
- Sync all playlists + tracks from Spotify to local DB
- List, show, rename, bulk-rename (regex), delete playlists
- Local metadata: tags, notes, pinning
- Push to Spotify: renames, track changes, description sync (tags + notes serialized to description)
- Playlist ID resolution: UUID, Spotify ID, Spotify URL, or exact name

**Excluded (vs. old design):** merge, duplicate detection, similarity suggestions, statistics, repair.

### 3.2 Group 2: Lexicon Matching & Tagging

**Scope:** Matching Spotify tracks against Lexicon library and tagging them.

**Features:**
- Non-blocking sync pipeline: match all tracks, tag confirmed ones immediately, park pending, return not-found
- Category-scoped tagging: only touches a configurable tag category (default "Spotify Playlists" / #1DB954), preserves all other categories
- Tag extraction: playlist name split by "/" produces tag labels (e.g., "Electronic/House/Deep" produces 3 tags), merged with manual tags
- Rejection memory: rejected match pairs (sourceId:targetId) are persisted and skipped on re-matching; next-best candidate tried
- Tag-on-next-sync: confirmed reviews are tagged on the next sync run, not by ReviewService
- Async review queue: pending matches accessible anytime from CLI or Web UI
- Review rejection auto-queues download for the track

**Excluded (vs. old design):** Lexicon playlist CRUD, blocking review phase, download orchestration within the pipeline.

### 3.3 Group 3: Download Pipeline

**Scope:** Acquiring missing tracks from Soulseek.

**Features:**
- Pipeline-only downloads (triggered by sync not-found or review rejection; no standalone download command)
- Multi-strategy search query builder (full → base-title → title-only → keywords)
- Configurable validation strictness (strict / moderate / lenient)
- Rejection memory: previously rejected Soulseek files filtered during ranking
- Files moved to `Lexicon/Incoming/{playlist-name}/`
- Manual wishlist only: `wishlist run` re-queues eligible failed downloads

**Excluded (vs. old design):** standalone download commands, automatic wishlist backoff schedule.

---

## 4. Database Schema

9 tables. All use UUID primary keys (`crypto.randomUUID()`). Timestamps are Unix milliseconds stored as integers.

### 4.1 `playlists`

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
| created_at | integer | NOT NULL | |
| updated_at | integer | NOT NULL, auto-update | |

### 4.2 `tracks`

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

### 4.3 `playlist_tracks` (junction)

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| playlist_id | text | FK → playlists.id, NOT NULL | |
| track_id | text | FK → tracks.id, NOT NULL | |
| position | integer | NOT NULL | 0-based order within playlist |
| added_at | integer | nullable | When Spotify reports it was added |
| | | UNIQUE(playlist_id, track_id) | |

### 4.4 `lexicon_tracks`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| file_path | text | UNIQUE, NOT NULL | Path in Lexicon library |
| title | text | NOT NULL | |
| artist | text | NOT NULL | |
| album | text | nullable | |
| duration_ms | integer | nullable | |
| last_synced | integer | NOT NULL | When fetched from Lexicon |

### 4.5 `matches`

Records every attempted match between a source track and a target track.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| source_type | text | NOT NULL | `"spotify"` / `"soulseek"` / `"file"` |
| source_id | text | NOT NULL | Track ID in source system |
| target_type | text | NOT NULL | `"spotify"` / `"lexicon"` / `"soulseek"` |
| target_id | text | NOT NULL | Track ID in target system |
| score | real | NOT NULL | 0.0 -- 1.0 similarity score |
| confidence | text | NOT NULL | `"high"` / `"review"` / `"low"` |
| method | text | NOT NULL | `"isrc"` / `"fuzzy"` / `"manual"` |
| status | text | NOT NULL | `"pending"` / `"confirmed"` / `"rejected"` |
| parked_at | integer | nullable | Unix ms when parked for async review |
| created_at | integer | NOT NULL | |
| updated_at | integer | NOT NULL | |
| | | UNIQUE(source_type, source_id, target_type, target_id) | |

### 4.6 `downloads`

Tracks the full lifecycle of a Soulseek download.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| track_id | text | FK → tracks.id, NOT NULL | |
| playlist_id | text | FK → playlists.id, nullable | |
| origin | text | NOT NULL | `"not_found"` / `"review_rejected"` |
| status | text | NOT NULL | See status enum below |
| soulseek_path | text | nullable | Source path on Soulseek |
| file_path | text | nullable | Final local file path |
| error | text | nullable | Error message if failed |
| started_at | integer | nullable | |
| completed_at | integer | nullable | |
| created_at | integer | NOT NULL | |

**Download status enum:** `pending` → `searching` → `downloading` → `validating` → `moving` → `done` | `failed`

### 4.7 `rejections`

Persists false matches to prevent repeating mistakes (Soulseek downloads).

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| track_id | text | FK → tracks.id, NOT NULL | The Spotify track we wanted |
| context | text | NOT NULL | e.g. `"soulseek_download"` |
| file_key | text | NOT NULL | username + filepath (unique Soulseek identifier) |
| reason | text | nullable | `"validation_failed"` / `"user_rejected"` / `"wrong_track"` |
| created_at | integer | NOT NULL | |
| | | UNIQUE(track_id, context, file_key) | |

Note: Lexicon match rejections are stored in the `matches` table with `status: "rejected"`. The `rejections` table is specifically for Soulseek download rejections.

### 4.8 `jobs`

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
| parent_job_id | text | nullable | FK → jobs.id for hierarchies |
| started_at | integer | nullable | |
| completed_at | integer | nullable | |
| created_at | integer | NOT NULL | |

**Job types:** `spotify_sync`, `lexicon_match`, `search`, `download`, `validate`, `lexicon_tag`, `wishlist_run`

No `run_after` column -- failed jobs stay failed and require manual re-queueing.

### 4.9 `sync_log`

Audit trail for sync operations.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | text | PK | UUID |
| playlist_id | text | FK → playlists.id, nullable | |
| action | text | NOT NULL | What happened |
| details | text | nullable | Additional context |
| created_at | integer | NOT NULL | |

---

## 5. Configuration

**Location:** `~/.config/crate-sync/config.json`

```jsonc
{
  "spotify": {
    "clientId": "",
    "clientSecret": "",
    "redirectUri": "http://127.0.0.1:8888/callback"
  },
  "lexicon": {
    "url": "http://localhost:48624",
    "downloadRoot": "",
    "tagCategory": {
      "name": "Spotify Playlists",
      "color": "#1DB954"
    }
  },
  "soulseek": {
    "slskdUrl": "http://localhost:5030",
    "slskdApiKey": "",
    "searchDelayMs": 5000,
    "downloadDir": ""
  },
  "matching": {
    "autoAcceptThreshold": 0.9,
    "reviewThreshold": 0.7
  },
  "download": {
    "formats": ["flac", "mp3"],
    "minBitrate": 320,
    "concurrency": 3,
    "validationStrictness": "moderate"
  },
  "jobRunner": {
    "pollIntervalMs": 1000
  }
}
```

**Token storage:** `~/.config/crate-sync/spotify-tokens.json` (auto-managed)

---

## 6. Matching Engine

### 6.1 Strategy Architecture

The matching engine uses a pluggable strategy pattern:

```
CompositeMatchStrategy
├── IsrcMatchStrategy     (exact ISRC code comparison)
└── FuzzyMatchStrategy    (weighted multi-field similarity)
```

The composite runs all strategies. If any returns "high" confidence, it returns immediately. Otherwise, it merges results keeping the best score per candidate.

### 6.2 ISRC Strategy

- Compares ISRC codes directly
- Score = 1.0 if match, no result otherwise
- Confidence = "high" (always)

### 6.3 Fuzzy Strategy

**Algorithms:**

| Algorithm | Description |
|-----------|-------------|
| Jaccard Similarity | Word-level set overlap: \|intersection\| / \|union\| |
| Damerau-Levenshtein | Edit distance supporting insertions, deletions, substitutions, transpositions |
| Edit Similarity | 1 - (edit_distance / max_length) |
| String Similarity | max(Jaccard, Edit) |
| Artist Similarity | String similarity, but floors at 0.7 if one name contains the other (handles "feat." cases) |
| Duration Similarity | 1 - (diff_ms / 30000)^1.5 -- smooth power decay |

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
- score >= `reviewThreshold` (default 0.7) → `"review"` (parked for async review)
- score < `reviewThreshold` → `"low"` (not found / candidate for download)

### 6.4 Match Persistence Rules

- Upsert by (source_type, source_id, target_type, target_id) -- deduplicated
- Never downgrade a confirmed match (re-runs reuse previously confirmed matches)
- Rejected match pairs are remembered and skipped; next-best candidate tried
- Pending matches have a `parked_at` timestamp for FIFO review ordering

---

## 7. Sync Pipeline

The sync pipeline is **non-blocking** -- it matches, tags, and returns. No review gate, no download orchestration within the pipeline.

### matchPlaylist(playlistId)

1. Fetch playlist tracks from local DB
2. Load entire Lexicon library (paginated, 1000 tracks/page)
3. Reuse existing confirmed matches (skip re-matching)
4. For unmatched tracks, run matching engine (ISRC + Fuzzy composite)
5. Consult rejection memory: skip rejected pairs, try next-best candidate
6. Categorize results:
   - **confirmed** (score >= 0.9) → tagged in Lexicon immediately
   - **pending** (score 0.7--0.9) → parked for async review
   - **notFound** (score < 0.7) → returned for download queue
7. Persist all matches to DB
8. Tag confirmed tracks via `syncTags()`

**Output:** `{ playlistName, confirmed[], pending[], notFound[], total, tagged }`

### syncTags(playlistName, confirmedTracks, manualTags?)

1. Split playlist name by "/" to extract tag labels
2. Merge with manual tags from playlist metadata, deduplicate
3. Ensure tag category exists in Lexicon (find-or-create)
4. Ensure each tag exists under the category (find-or-create)
5. For each confirmed track: `setTrackCategoryTags()` (category-scoped, preserves other categories)

### Review Flow (decoupled)

```
matchPlaylist() →
  confirmed (>= 0.9)  → tag immediately
  pending (0.7–0.9)   → park for async review
  notFound (< 0.7)    → queue for download

reviewConfirm(matchId) → tagged on next sync run
reviewReject(matchId)  → auto-queue download for that track

Next sync → re-matches, discovers newly imported tracks → tags them
```

---

## 8. Search & Download

### 8.1 Multi-Strategy Query Builder

`generateSearchQueries(track)` produces up to 4 strategies, tried in order:

| # | Strategy | Example |
|---|----------|---------|
| 1 | Full | `"Ivory Reliquia German Brigante Remix"` |
| 2 | Base-Title | `"Ivory Reliquia"` (remix suffix stripped) |
| 3 | Title-Only | `"Reliquia German Brigante Remix"` |
| 4 | Keywords | `"Ivory Reliquia German"` (first 2 significant words) |

### 8.2 Result Ranking

After search, results are filtered and ranked:
1. **Rejection filter** — exclude previously rejected files for this track
2. **Format filter** — only accepted formats (default: flac, mp3)
3. **Bitrate filter** — minimum bitrate (default: 320 kbps)
4. **Fuzzy match** — score results against track metadata
5. **Sort** — by match score descending

### 8.3 Download Lifecycle

`pending` → `searching` → `downloading` → `validating` → `moving` → `done` | `failed`

Files are moved to `Lexicon/Incoming/{playlist-name}/`. Validation strictness is configurable (strict/moderate/lenient). Failed validation creates a rejection entry to avoid re-downloading the same file.

---

## 9. Job Queue

### 9.1 Design

SQLite-polled job queue running in-process alongside the Hono server. Designed so migration to a message broker (BullMQ/Redis) is straightforward -- all handlers stay identical.

### 9.2 Job Lifecycle

```
queued ──→ running ──→ done
                  └──→ failed (stays failed until manual retry)
```

**Atomic claiming:** `UPDATE jobs SET status='running' WHERE id=? AND status='queued'` prevents double-processing.

No automatic backoff or re-queueing. Failed jobs require explicit retry via API/CLI or `wishlist run`.

### 9.3 Job Handlers

| Type | Behavior | Creates Children |
|------|----------|-----------------|
| `spotify_sync` | Fetch playlist from Spotify, upsert to DB | → `lexicon_match` |
| `lexicon_match` | Run `SyncPipeline.matchPlaylist()` | → `search` (for each notFound) |
| `search` | Multi-strategy Soulseek search + ranking | → `download` (if results found) |
| `download` | Download file, validate, move to Lexicon folder | (none) |
| `validate` | Post-download metadata validation | (none) |
| `lexicon_tag` | Sync tags for confirmed tracks in Lexicon | (none) |
| `wishlist_run` | Re-queue eligible failed search/download jobs | → `search` |

### 9.4 Wishlist

Manual retry system for failed downloads:
- Triggered only via `crate-sync wishlist run` or `POST /api/wishlist/run`
- Scans for eligible failed search/download jobs
- Re-queues with the next query strategy
- No automatic scheduling or backoff intervals

### 9.5 Event System

Job state changes emit events via an in-memory listener set, consumed by:
- SSE endpoint (`GET /api/jobs/stream`) for Web UI real-time updates
- CLI thin-client mode for terminal progress display

---

## 10. External Service Integrations

### 10.1 Spotify Web API

**Authentication:** OAuth 2.0 Authorization Code flow

**Scopes:** `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, `playlist-modify-private`, `user-library-read`

**Token management:** Stored in `~/.config/crate-sync/spotify-tokens.json`, auto-refreshed 60s before expiry.

**Operations:**
- Get all user playlists (paginated)
- Get playlist tracks (paginated)
- Sync playlists + tracks to local DB (upsert by spotify_id)
- Rename playlist
- Update playlist details (name, description)
- Add/remove tracks (batched in groups of 100)
- Replace all tracks

### 10.2 Lexicon DJ API

**Base URL:** Configurable (default `http://localhost:48624`)

**Operations (tags only, no playlists):**
- Ping (connectivity check)
- Get all tracks (paginated, 1000/page)
- Search tracks (client-side filtering, no server search endpoint)
- Get single track
- Get/create tag categories and tags
- Get/update track tags
- Ensure tag category exists (find-or-create)
- Ensure tag exists (find-or-create)
- Get track tags in category (category-scoped read)
- Set track category tags (read-filter-merge-write, preserves other categories)

**Response unwrapping:** Handles multiple wrapper formats (data, content, direct array).

### 10.3 Soulseek (via slskd)

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

## 11. CLI Commands

```
crate-sync [--debug] <command>

  status                                          Check connectivity to all external services
  auth login                                      Start Spotify OAuth flow
  auth status                                     Show authentication status
  db sync                                         Sync Spotify playlists to local DB
  db status                                       Show database statistics
  playlists list                                  List playlists from local DB
  playlists show <id>                             Show playlist details and tracks
  playlists rename <id> <name>                    Rename a playlist
  playlists bulk-rename <pattern> <replacement>   Bulk rename playlists (supports --regex)
  playlists delete <id>                           Delete a playlist
  playlists push [id]                             Push local changes to Spotify (--all)
  lexicon status                                  Test Lexicon connection
  lexicon match <playlist>                        Match playlist tracks against Lexicon library
  matches list                                    List matches from the database
  matches confirm <id>                            Confirm a match
  matches reject <id>                             Reject a match
  review list                                     List pending review items
  review confirm <id>                             Confirm a pending review match
  review reject <id>                              Reject a pending review match (queues download)
  review bulk-confirm                             Bulk confirm pending matches
  review bulk-reject                              Bulk reject pending matches (queues downloads)
  sync [playlist]                                 Run the non-blocking sync pipeline (--all, --dry-run)
  serve                                           Start web UI + API server + job runner (--port, --no-jobs)
  jobs list                                       List jobs (--status, --type)
  jobs retry <id>                                 Re-queue a failed job
  jobs retry-all                                  Re-queue all failed jobs (--type)
  jobs stats                                      Show job statistics
  wishlist run                                    Manually trigger a wishlist run
```

Playlist ID accepts: UUID, Spotify ID, Spotify URL, or exact name.

`--debug` enables file logging to `./data/crate-sync.log`.

---

## 12. REST API

Base URL: `/api`

### 12.1 Status & Configuration

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

### 12.2 Playlists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/playlists` | List all playlists with track counts |
| POST | `/playlists/sync` | Sync all from Spotify |
| POST | `/playlists/bulk-rename` | Batch rename with dry-run preview |
| GET | `/playlists/:id` | Playlist detail with trackCount + totalDurationMs |
| PATCH | `/playlists/:id` | Update metadata (tags, notes, pinned) |
| PUT | `/playlists/:id/rename` | Rename playlist |
| DELETE | `/playlists/:id` | Delete playlist |
| POST | `/playlists/:id/push` | Push local changes to Spotify (including description) |
| GET | `/playlists/:id/tracks` | Get tracks ordered by position |

### 12.3 Tracks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tracks?q=&limit=&offset=` | Search/list tracks |
| GET | `/tracks/:id` | Track details |
| GET | `/tracks/:id/lifecycle` | Full lifecycle (playlists, matches, downloads, jobs, rejections) |
| GET | `/tracks/:id/rejections` | Rejection history for a track |

### 12.4 Matches

| Method | Path | Description |
|--------|------|-------------|
| GET | `/matches?status=` | List matches (enriched with source + target tracks) |
| PUT | `/matches/:id` | Update match status (confirmed/rejected; rejection auto-queues download) |

### 12.5 Review

| Method | Path | Description |
|--------|------|-------------|
| GET | `/review` | List pending review items (optional `?playlistId=` filter) |
| POST | `/review/:id/confirm` | Confirm a pending match |
| POST | `/review/:id/reject` | Reject a pending match (auto-queues download) |
| POST | `/review/bulk` | Bulk confirm or reject (`{ matchIds, action }`) |
| GET | `/review/stats` | Review queue statistics (pending/confirmed/rejected counts) |

### 12.6 Downloads

| Method | Path | Description |
|--------|------|-------------|
| GET | `/downloads?status=&playlistId=` | List downloads (enriched with track info) |
| GET | `/downloads/:id` | Download detail |

### 12.7 Sync

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/:playlistId` | Start non-blocking sync → `{syncId, jobId}` |
| POST | `/sync/:playlistId/dry-run` | Match phase only → match results |
| GET | `/sync/:syncId/events` | SSE stream (phase, match-complete, download-progress, sync-complete, error) |
| GET | `/sync/:syncId` | Sync session status |

### 12.8 Wishlist

| Method | Path | Description |
|--------|------|-------------|
| POST | `/wishlist/run` | Manually trigger a wishlist run |

### 12.9 Jobs

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

## 13. Web UI

### 13.1 Design System

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

### 13.2 Pages

**Dashboard** (`/`)
- Stat cards: playlists, tracks, total duration, pending reviews, active downloads, queued jobs
- Service status table (Spotify, Lexicon, Soulseek, Database) with OK/error indicators
- Spotify auth widget (login/logout with OAuth flow)
- Soulseek connection widget (URL + API key)

**Playlists** (`/playlists`)
- Sortable table (Name, Tracks, Owner, Last Synced) with sort indicators
- Search bar, ownership filter, tag filter dropdown, pinned sort to top
- Per-row actions: View, Rename (modal), Delete (confirmation modal)
- Checkbox multi-select with floating bulk toolbar
- "Sync from Spotify" button
- "Bulk Rename" button with modal (find-replace / regex, dry-run preview, apply)

**Playlist Detail** (`/playlists/:id`)
- Header: name, track count, pin toggle
- Action buttons: Start Sync, Push to Spotify, Rename, Delete
- Tags card with add/remove, Notes card with save-on-blur
- Description sync preview (tags + notes serialized)
- Sync progress (SSE events), review panel for pending matches
- Track table: sortable, searchable, clickable rows

**Review** (`/review`)
- Sidebar badge showing pending count
- Side-by-side Spotify vs Lexicon comparison cards
- Score badge with percentage, per-match Confirm / Reject buttons
- Reject button labeled "Reject & Queue Download"
- Bulk: Confirm All / Reject All
- Always accessible (not gated by sync session)

**Matches** (`/matches`)
- Status filter (all / pending / confirmed / rejected)
- Table with source track, target track, score, confidence, status, actions

**Downloads** (`/downloads`)
- Status filter, table with track info, status badge, file path, error, timestamps

**Queue** (`/queue`)
- Stat cards by status, type/status filters, live job table with SSE
- Per-job Retry/Cancel, Retry All Failed, drill-down to Job Detail

**Job Detail** (`/queue/:id`)
- Full job info, payload/result as JSON, error, child jobs, parent link

**Track Detail** (`/tracks/:id`)
- Spotify metadata, playlist membership, match history, download history
- Rejection history (both Lexicon match rejections and Soulseek download rejections)
- Related jobs

**Settings** (`/settings`)
- Matching thresholds, download config (formats, bitrate, concurrency, validation strictness)
- Service credentials

### 13.3 Routes

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

## 14. Build & Deployment

### 14.1 Scripts

```bash
pnpm dev <args>        # Run CLI in development (tsx)
pnpm dev serve         # Start dev server
pnpm build             # Build CLI (tsup) + Web (vite)
pnpm test              # Run vitest
pnpm test:coverage     # Run with coverage
```

### 14.2 Build Output

- **CLI:** `dist/index.js` (ESM, shebang `#!/usr/bin/env node`)
- **Web:** `web/dist/` (SPA with router)
- Server serves `web/dist/` as static files with SPA fallback

### 14.3 Runtime

- Single Node.js process
- SQLite database at `./data/crate-sync.db` (WAL mode)
- Config at `~/.config/crate-sync/config.json`
- Tokens at `~/.config/crate-sync/spotify-tokens.json`

---

## 15. Spec Index

All detailed implementation specs are in `.beans/`. Organized by epic:

### E0: Foundation

| Spec | Title |
|------|-------|
| spec-01 | Project scaffold and build tooling |
| spec-02 | Type definitions |
| spec-03 | Configuration module |
| spec-04 | Database schema and client |
| spec-05 | Utility modules |

### E1: Spotify Sync & Playlist Management (Group 1)

| Spec | Title |
|------|-------|
| spec-06 | Spotify service |
| spec-07 | Playlist service (DB-only operations) |
| spec-08 | Spotify push (local-to-Spotify sync) |

### E2: Lexicon Matching & Tagging (Group 2)

| Spec | Title |
|------|-------|
| spec-09 | Matching engine |
| spec-10 | Lexicon service |
| spec-11 | Sync pipeline |
| spec-12 | Review service |

### E3: Download Pipeline (Group 3)

| Spec | Title |
|------|-------|
| spec-13 | Search query builder |
| spec-14 | Soulseek service (slskd client) |
| spec-15 | Download pipeline |

### E4: Orchestration (spans all groups)

| Spec | Title |
|------|-------|
| spec-16 | Job queue: runner and handlers |
| spec-17 | API server |
| spec-18 | API routes |
| spec-19 | CLI: commands and entry point |

### E5: Web Frontend (spans all groups)

| Spec | Title |
|------|-------|
| spec-20 | Web frontend |

### Implementation Sequencing

```
Phase A (Foundation):  01 → 02, 03, 05 (parallel) → 04
Phase B (Group 1):     06 → 07 → 08
Phase C (Group 2):     09 (can start in Phase A), 10 → 11 → 12
Phase D (Group 3):     13 (can start in Phase A), 14 → 15
Phase E (Orchestration): 16 → 17 → 18, 19
Phase F (Web):         20
```

---

## 16. Version History

| Version | Date | Highlights |
|---------|------|-----------|
| 0.1.0 | 2026-03-09 | Initial CLI: auth, db, playlists, matching, 3-phase sync, download |
| 0.2.0 | 2026-03-10 | Lexicon API fixes, push to Spotify, repair, health checks, retry, progress, graceful shutdown |
| 0.3.0 | 2026-03-15 | Web UI (Hono + React), improved matching (Damerau-Levenshtein, normalization, context weights) |
| 0.4.0 | 2026-03-17 | Multi-strategy query builder, job queue with SQLite polling, wishlist, queue/review/track pages, CLI thin client |
| 0.5.0 | 2026-03-19 | Playlist management: sort/search/filter, rename/delete, push, merge, duplicates, bulk rename, metadata (tags/notes/pinning) |
| 0.6.0 | unreleased | 3-group architecture: non-blocking sync, async review, category-scoped Lexicon tagging (no playlists), rejection memory, description sync, pipeline-only downloads, manual wishlist |
