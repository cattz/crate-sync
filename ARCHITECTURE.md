# Crate Sync — Architecture

## Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Language** | TypeScript (ESM) | Single language, strong typing, good ecosystem |
| **Runtime** | Node.js | Mature, good library support for all integrations |
| **Package Manager** | pnpm | Fast, disk-efficient |
| **CLI Framework** | Commander.js | Simplest, most proven (~308M weekly downloads) |
| **Database** | SQLite via better-sqlite3 | Synchronous, fast, zero-config |
| **ORM** | Drizzle ORM + drizzle-kit | Schema-first, typed queries, built-in migrations |
| **Spotify API** | spotify-web-api-ts or @spotify/web-api-ts-sdk | Official/typed Spotify client |
| **Soulseek** | TBD — see below | Critical dependency, limited options |
| **Lexicon DJ** | Custom HTTP client | REST API at `localhost:48624/v1` |
| **Audio Metadata** | music-metadata | Read MP3 ID3 / FLAC Vorbis tags for validation |
| **Fuzzy Matching** | fuse.js or custom | Weighted scoring with configurable thresholds |
| **Testing** | vitest | Fast, native TypeScript/ESM support |
| **Build** | tsup | Simple, fast bundling for CLI |

### Soulseek Client — Options

This is the riskiest dependency. Options in order of preference:

1. **slskd REST API** — Run [slskd](https://github.com/slskd/slskd) as a local server, talk to it via HTTP. Most reliable, actively maintained, decouples protocol complexity. Adds a runtime dependency (Docker or binary).
2. **andrade-soulseek-downloader** — npm package, single maintainer. Has built-in rate limiting. Risk: could go unmaintained.
3. **soulseek-ts** — TypeScript native, but stale (~2 years no updates).
4. **Port from Python** — Use aioslsk logic as reference to build our own. High effort.

**Decision**: Use **slskd REST API**. Searches are rate-limited (configurable delay). Downloads are concurrent (no rate limit).

---

## Layer Architecture

The codebase follows a **ports-and-adapters** (hexagonal) pattern. Dependencies flow inward: entry points → services → ports ← adapters.

```
┌─────────────────────────────────────────────────────────┐
│  Entry Points                                           │
│  commands/  api/routes/  jobs/handlers/                  │
│  Parse input, wire services, format output. No logic.   │
├─────────────────────────────────────────────────────────┤
│  Application Services                                   │
│  PlaylistService  SyncPipeline  ReviewService           │
│  DownloadService                                        │
│  Business logic. Depend on port interfaces, not DB.     │
├─────────────────────────────────────────────────────────┤
│  Ports (src/ports/)                                     │
│  IPlaylistRepository  ITrackRepository                  │
│  IPlaylistTrackRepository  IMatchRepository             │
│  IDownloadRepository  IRejectionRepository              │
│  Abstract interfaces — no implementation details.       │
├─────────────────────────────────────────────────────────┤
│  Adapters                                               │
│  DB:  db/repositories/  (Drizzle implementations)       │
│  API: SpotifyApiClient  LexiconService  SoulseekService │
│  Concrete I/O. Only layer that touches Drizzle or HTTP. │
└─────────────────────────────────────────────────────────┘
```

**Dependency rule**: Services import from `ports/`, never from `db/schema` or `db/repositories/` directly. The `fromDb()` / `fromConfig()` factory methods on each service handle the wiring.

## Project Structure

```
crate-sync/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── commands/                # One file per command group
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   ├── playlists.ts
│   │   ├── lexicon.ts
│   │   ├── download.ts
│   │   ├── matches.ts
│   │   ├── sync.ts
│   │   ├── serve.ts
│   │   └── jobs.ts              # Job queue + wishlist CLI
│   ├── ports/                   # Abstract interfaces (ports)
│   │   └── repositories.ts      # IPlaylistRepository, ITrackRepository, etc.
│   ├── services/                # Application services + API adapters
│   │   ├── spotify-api-client.ts # Spotify API adapter (auth + HTTP)
│   │   ├── spotify-service.ts   # Re-export of SpotifyApiClient (compat)
│   │   ├── lexicon-service.ts   # Lexicon REST API adapter
│   │   ├── soulseek-service.ts  # slskd REST API adapter
│   │   ├── download-service.ts  # Download orchestration
│   │   ├── playlist-service.ts  # Playlist CRUD + Spotify→DB sync
│   │   ├── review-service.ts    # Match review workflow
│   │   ├── sync-pipeline.ts     # Spotify→Lexicon matching pipeline
│   │   └── spotify-push.ts      # Push local changes to Spotify
│   ├── search/                  # Multi-strategy search query builder
│   │   └── query-builder.ts
│   ├── jobs/                    # Background job queue
│   │   ├── runner.ts            # Polling loop, claim/complete/fail
│   │   └── handlers/            # One handler per job type
│   │       ├── spotify-sync.ts
│   │       ├── lexicon-match.ts
│   │       ├── search.ts
│   │       ├── download.ts
│   │       ├── download-scan.ts
│   │       ├── validate.ts
│   │       ├── lexicon-tag.ts
│   │       └── wishlist-run.ts
│   ├── api/                     # Hono API server
│   │   ├── server.ts
│   │   ├── state.ts             # In-memory sync session state
│   │   └── routes/
│   │       ├── playlists.ts
│   │       ├── tracks.ts
│   │       ├── matches.ts
│   │       ├── downloads.ts
│   │       ├── review.ts
│   │       ├── status.ts
│   │       ├── sync.ts
│   │       └── jobs.ts          # Job queue REST API + SSE
│   ├── db/
│   │   ├── schema.ts            # Drizzle schema definitions + types
│   │   ├── client.ts            # DB connection singleton
│   │   ├── migrations/          # Generated by drizzle-kit
│   │   └── repositories/        # Drizzle-backed port implementations
│   │       ├── index.ts         # Barrel + createRepositories()
│   │       ├── playlist-repository.ts
│   │       ├── track-repository.ts
│   │       ├── playlist-track-repository.ts
│   │       ├── match-repository.ts
│   │       ├── download-repository.ts
│   │       └── rejection-repository.ts
│   ├── matching/                # Pluggable matching strategies
│   │   ├── index.ts             # Composite factory
│   │   ├── types.ts             # MatchStrategy interface
│   │   ├── fuzzy.ts             # Fuzzy title+artist matching
│   │   ├── isrc.ts              # Exact ISRC matching
│   │   ├── composite.ts         # Strategy orchestrator
│   │   └── normalize.ts         # Unicode, stopwords, remix stripping
│   ├── types/                   # Shared type definitions
│   │   ├── spotify.ts
│   │   ├── lexicon.ts
│   │   ├── soulseek.ts
│   │   └── common.ts
│   ├── utils/                   # Logger, retry, progress, shutdown, description
│   └── config.ts                # Config loading (CLI > env > file)
├── web/                         # React frontend (Vite)
│   └── src/
│       ├── pages/               # Dashboard, Playlists, Matches, Downloads, Queue, Settings
│       └── api/                 # React Query hooks + API client
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── tsup.config.ts
```

---

## Key Design Decisions

### 1. Commands are thin, services use ports

Commands parse args and wire services. All business logic lives in services. Services depend on repository interfaces (ports), not on the DB directly.

```
Command (parse args) → Service (business logic) → Port interface ← Adapter (DB / HTTP)
```

Each service has a `fromDb()` or `fromConfig()` factory that creates concrete Drizzle-backed repositories. Tests can inject in-memory implementations instead.

### 2. Matching is a first-class abstraction

```typescript
interface MatchStrategy {
  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[];
}

interface MatchResult {
  candidate: TrackInfo;
  score: number;         // 0.0 - 1.0
  confidence: 'high' | 'review' | 'low';
  method: string;        // 'isrc' | 'fuzzy' | etc.
}
```

Strategies are composable. The `CompositeStrategy` tries ISRC first (exact), then falls back to fuzzy. Each context (dedup, Lexicon sync, Soulseek search) can configure its own thresholds.

### 3. Multi-strategy search query builder

Soulseek searches are unreliable for remix titles, featured artists, and long track names. The query builder generates up to 4 search strategies per track, tried in order:

1. **Full** — `"{artist} {title}"` with cleaned parens/brackets/dashes
2. **Base title** — strip remix/edit suffix via `stripRemixSuffix()`
3. **Title only** — handles variant artist spellings on Soulseek
4. **Keywords** — artist + first 2 significant words from title

The download service tries each strategy sequentially and stops at the first with results. Batch search uses strategy 1 upfront, then falls back to multi-strategy for 0-result tracks.

### 4. Job queue

The sync pipeline is decomposed into independent jobs stored in a `jobs` table (SQLite polling). A single-process job runner claims jobs atomically (`UPDATE WHERE status='queued'`), runs them, and creates child jobs for the next step:

```
spotify_sync → match → search → download → (validate) → lexicon_sync
```

Failed jobs are retried with exponential backoff (1h → 6h → 24h → 7d). A periodic wishlist scanner re-queues failed searches past their cooldown.

Designed so migration to a message broker (BullMQ/Redis) is ~2-3 days: replace `db.insert(jobs)` with `queue.add()`, replace polling with `worker.process()`, keep all handlers identical.

### 5. Three-phase pipeline

The sync pipeline separates concerns to avoid blocking the user:

```
Phase 1: MATCH (batch)     — All tracks matched against Lexicon, no user input needed
Phase 2: REVIEW (interactive) — User confirms/rejects all uncertain matches at once
Phase 3: DOWNLOAD (autonomous) — Searches + downloads run unattended
```

State is persisted between phases so the pipeline can be resumed.

### 4. Lexicon integration via REST API

Lexicon exposes a local REST API at `http://localhost:48624/v1`. Key quirks from existing implementations:

- **Playlist update is REPLACE, not append** — always fetch current trackIds, merge, then send back
- **IDs can be int or string** — normalize to string
- **Response wrapping varies** — handle `{data: {...}}`, `{tracks: [...]}`, and bare arrays
- **Search uses bracket filter syntax** — `filter[artist]=X&filter[title]=Y`

### 5. Soulseek rate limiting

Searches are rate-limited (configurable delay between searches) to avoid bans. Downloads are not rate-limited — they can run concurrently.

### 6. Downloaded files go to Lexicon incoming folder

After download completes:
1. **Validate tags** — Read MP3 ID3 / FLAC Vorbis tags and verify artist+title match the expected track
2. **Rename** — `<Artist> - <Title>.<ext>` (sanitized for filesystem)
3. **Move** — Place in `<downloadRoot>/<playlistName>/`
4. **Import** — Lexicon watches the download root and auto-imports new files
5. **Playlist** — Re-match against Lexicon, add to playlist preserving Spotify track order

---

## Data Flow

```
┌─────────┐     ┌──────────┐     ┌────────┐
│ Spotify  │────▶│  SQLite   │────▶│  CLI   │
│   API    │     │  (local)  │     │ output │
└─────────┘     └──────────┘     └────────┘
                     │
                     ▼
               ┌───────────┐
               │  Matcher   │
               │  Engine    │
               └───────────┘
                 │       │
        ┌────────┘       └────────┐
        ▼                         ▼
  ┌───────────┐            ┌───────────┐
  │  Lexicon   │            │ Soulseek  │
  │  REST API  │◀───────────│  (slskd)  │
  └───────────┘  incoming   └───────────┘
                  folder
```

---

## Configuration

Single config file at `~/.config/crate-sync/config.json`:

```json
{
  "spotify": {
    "clientId": "...",
    "clientSecret": "...",
    "redirectUri": "http://localhost:8888/callback"
  },
  "lexicon": {
    "url": "http://localhost:48624",
    "downloadRoot": "/path/to/music/downloads"
  },
  "soulseek": {
    "slskdUrl": "http://localhost:5030",
    "slskdApiKey": "...",
    "searchDelayMs": 5000
  },
  "matching": {
    "autoAcceptThreshold": 0.9,
    "reviewThreshold": 0.7
  },
  "download": {
    "formats": ["flac", "mp3"],
    "minBitrate": 320
  },
  "jobRunner": {
    "pollIntervalMs": 1000,
    "wishlistIntervalMs": 21600000
  }
}
```

CLI flags override config file values.

---

## Database Schema (Drizzle)

See `FEATURES.md` for entity descriptions. Core tables:

- `playlists` — Cached Spotify playlists
- `tracks` — Cached Spotify tracks
- `playlist_tracks` — Junction table with position
- `lexicon_tracks` — Cached Lexicon library tracks
- `matches` — Match registry (source, target, score, status)
- `downloads` — Download state machine (pending → searching → downloading → validating → done/failed)
- `jobs` — Job queue (type, status, priority, payload JSON, result JSON, attempt tracking, backoff, parent-child)
- `sync_log` — Audit trail

---

## Future Extensibility

- **Tidal**: Add a `TidalApiClient` implementing the same patterns as `SpotifyApiClient`
- **TUI**: Import services directly, add Ink/Textual layer on top
- **Message broker**: Replace SQLite job polling with BullMQ/Redis (~2-3 day migration). All handlers stay identical.
- **Alternative storage**: Swap Drizzle repositories for any other implementation (e.g., PostgreSQL) by implementing the port interfaces in `src/ports/repositories.ts`
