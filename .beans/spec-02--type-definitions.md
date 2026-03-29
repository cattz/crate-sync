---
# spec-02
title: Type definitions
status: todo
type: task
priority: critical
parent: spec-E0
depends_on: spec-01
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

# spec-02: Type definitions

## Purpose

Define the complete set of shared TypeScript interfaces and type aliases used across the crate-sync codebase. These types represent the domain model for Spotify playlists/tracks, Lexicon DJ library data, Soulseek/slskd download data, and cross-service matching/sync primitives. Every exported type is specified here with every field, its TypeScript type, and whether it is optional.

## Public Interface

### File: `src/types/common.ts`

```ts
export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  uri?: string;
}

export interface MatchResult {
  candidate: TrackInfo;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

export type SyncPhase = "match" | "review" | "download";

export type DownloadStatus =
  | "pending"
  | "searching"
  | "downloading"
  | "validating"
  | "moving"
  | "done"
  | "failed";

export type MatchStatus = "pending" | "confirmed" | "rejected";

export type ReviewStatus = "pending" | "confirmed" | "rejected";
```

#### `TrackInfo`

A minimal, source-agnostic representation of a music track. Used as the common currency when matching tracks across different services.

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Track title |
| `artist` | `string` | Yes | Primary artist name |
| `album` | `string` | No | Album name |
| `durationMs` | `number` | No | Track duration in milliseconds |
| `isrc` | `string` | No | International Standard Recording Code |
| `uri` | `string` | No | Source-specific URI (e.g., Spotify URI, file path) |

#### `MatchResult`

The result of comparing a source track against a candidate target track.

| Field | Type | Required | Description |
|---|---|---|---|
| `candidate` | `TrackInfo` | Yes | The matched candidate track |
| `score` | `number` | Yes | Numeric match score (0.0 to 1.0) |
| `confidence` | `"high" \| "review" \| "low"` | Yes | Confidence tier based on score thresholds |
| `method` | `string` | Yes | Matching method used (e.g., `"isrc"`, `"fuzzy"`, `"manual"`) |

#### `SyncPhase`

Enum of the three phases in a sync pipeline run.

| Value | Description |
|---|---|
| `"match"` | Matching Spotify tracks to Lexicon tracks |
| `"review"` | Human review of uncertain matches |
| `"download"` | Downloading missing tracks from Soulseek |

#### `DownloadStatus`

Lifecycle states for a download task.

| Value | Description |
|---|---|
| `"pending"` | Queued but not yet started |
| `"searching"` | Searching Soulseek for the file |
| `"downloading"` | Actively downloading from a peer |
| `"validating"` | Verifying file integrity and metadata |
| `"moving"` | Moving file to the Lexicon library directory |
| `"done"` | Successfully completed |
| `"failed"` | Failed with an error |

#### `MatchStatus`

Human review status for a match.

| Value | Description |
|---|---|
| `"pending"` | Awaiting human review |
| `"confirmed"` | Human confirmed the match is correct |
| `"rejected"` | Human rejected the match as incorrect |

#### `ReviewStatus`

Status for async review items. Used by the review service to track pending/confirmed/rejected matches that are parked for human review outside the main pipeline flow.

| Value | Description |
|---|---|
| `"pending"` | Match is parked, awaiting async review |
| `"confirmed"` | Reviewer confirmed the match -- track will be tagged on next sync |
| `"rejected"` | Reviewer rejected the match -- track is auto-queued for download |

---

### File: `src/types/spotify.ts`

```ts
export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  snapshotId: string;
  trackCount: number;
  uri: string;
  ownerId: string;
  ownerName: string;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  durationMs: number;
  isrc?: string;
  uri: string;
}
```

#### `SpotifyPlaylist`

Represents a Spotify playlist as returned by the Spotify Web API (simplified).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Spotify playlist ID (e.g., `"37i9dQZF1DXcBWIGoYBM5M"`) |
| `name` | `string` | Yes | Playlist display name |
| `description` | `string` | No | Playlist description text |
| `snapshotId` | `string` | Yes | Spotify snapshot ID for change detection |
| `trackCount` | `number` | Yes | Total number of tracks in the playlist |
| `uri` | `string` | Yes | Spotify URI (e.g., `"spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"`) |
| `ownerId` | `string` | Yes | Spotify user ID of the playlist owner |
| `ownerName` | `string` | Yes | Display name of the playlist owner |

#### `SpotifyTrack`

Represents a single track from the Spotify Web API.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Spotify track ID |
| `title` | `string` | Yes | Track title |
| `artist` | `string` | Yes | Primary artist name (first artist) |
| `artists` | `string[]` | Yes | All artist names |
| `album` | `string` | Yes | Album name |
| `durationMs` | `number` | Yes | Duration in milliseconds |
| `isrc` | `string` | No | ISRC code from Spotify external IDs |
| `uri` | `string` | Yes | Spotify URI (e.g., `"spotify:track:abc123"`) |

---

### File: `src/types/lexicon.ts`

```ts
export interface LexiconTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  tags?: string[];
}

export interface LexiconTagCategory {
  id: string;
  label: string;
  color?: string;
}

export interface LexiconTag {
  id: string;
  categoryId: string;
  label: string;
}

export interface LexiconTagConfig {
  categoryName: string;
  color: string;
}
```

#### `LexiconTrack`

Represents a track in the Lexicon DJ library.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Lexicon internal track ID |
| `filePath` | `string` | Yes | Absolute path to the audio file on disk |
| `title` | `string` | Yes | Track title from metadata |
| `artist` | `string` | Yes | Artist name from metadata |
| `album` | `string` | No | Album name from metadata |
| `durationMs` | `number` | No | Duration in milliseconds |
| `tags` | `string[]` | No | Array of tag labels applied to this track |

#### `LexiconTagCategory`

A tag category in Lexicon (e.g., "Genre", "Mood", "Energy").

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Category ID |
| `label` | `string` | Yes | Display label (e.g., `"Genre"`) |
| `color` | `string` | No | Hex color code for UI display |

#### `LexiconTag`

A single tag within a category.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Tag ID |
| `categoryId` | `string` | Yes | Parent category ID |
| `label` | `string` | Yes | Tag label (e.g., `"Techno"`) |

#### `LexiconTagConfig`

Configuration for the Lexicon tag category that crate-sync manages. Used to identify which tag category to create/use in Lexicon for playlist-to-tag mapping.

| Field | Type | Required | Description |
|---|---|---|---|
| `categoryName` | `string` | Yes | Name of the tag category in Lexicon (e.g., `"Spotify Playlists"`) |
| `color` | `string` | Yes | Hex color code for the category (e.g., `"#1DB954"` -- Spotify green) |

---

### File: `src/types/soulseek.ts`

```ts
export interface SlskdFile {
  filename: string;
  size: number;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  length?: number;
  username: string;
  code: string;
}

export interface SlskdSearchResult {
  id: string;
  searchText: string;
  state: string;
  fileCount: number;
  files: SlskdFile[];
}

export interface SlskdTransfer {
  id: string;
  username: string;
  filename: string;
  state: string;
  bytesTransferred: number;
  size: number;
  percentComplete: number;
}
```

#### `SlskdFile`

A single file available on the Soulseek network via slskd.

| Field | Type | Required | Description |
|---|---|---|---|
| `filename` | `string` | Yes | Full file path on the remote peer |
| `size` | `number` | Yes | File size in bytes |
| `bitRate` | `number` | No | Audio bit rate in kbps |
| `sampleRate` | `number` | No | Audio sample rate in Hz |
| `bitDepth` | `number` | No | Audio bit depth |
| `length` | `number` | No | Audio duration in seconds |
| `username` | `string` | Yes | Soulseek username of the peer sharing this file |
| `code` | `string` | Yes | slskd internal code for this file entry |

#### `SlskdSearchResult`

A search result set from slskd containing matched files.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | slskd search ID |
| `searchText` | `string` | Yes | The search query that was submitted |
| `state` | `string` | Yes | Search state (e.g., `"Completed"`) |
| `fileCount` | `number` | Yes | Total number of matching files |
| `files` | `SlskdFile[]` | Yes | Array of matching files |

#### `SlskdTransfer`

Represents an active or completed file transfer in slskd.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | slskd transfer ID |
| `username` | `string` | Yes | Peer username |
| `filename` | `string` | Yes | Remote file path |
| `state` | `string` | Yes | Transfer state (e.g., `"Completed"`, `"InProgress"`) |
| `bytesTransferred` | `number` | Yes | Number of bytes transferred so far |
| `size` | `number` | Yes | Total file size in bytes |
| `percentComplete` | `number` | Yes | Percentage of transfer completed (0-100) |

## Dependencies

None -- these are pure type definitions with no runtime imports.

## Behavior

All types are compile-time only. They have no runtime behavior. They are used for:

1. **Service layer contracts** -- Spotify, Lexicon, and Soulseek service classes accept/return these types.
2. **Matching engine input/output** -- `TrackInfo` is the universal input format; `MatchResult` is the output.
3. **Status tracking** -- `DownloadStatus`, `MatchStatus`, `ReviewStatus`, and `SyncPhase` are used in the database schema (as text enum columns) and in CLI/API output.
4. **Type narrowing** -- Confidence levels (`"high" | "review" | "low"`) drive automatic accept/reject logic based on configured thresholds.
5. **Lexicon tag configuration** -- `LexiconTagConfig` is used by the configuration module (spec-03) and the Lexicon service (spec-10) to manage category-scoped tagging.

## Error Handling

Not applicable -- these are type definitions only. Type errors are caught at compile time by `tsc --noEmit`.

## Tests

Type definitions do not have runtime tests. Correctness is validated by:

1. **Compile-time verification** -- `pnpm lint` (`tsc --noEmit`) must pass with these types in use across the codebase.
2. **Structural tests** -- Any service test that constructs objects of these types implicitly validates the type shape.

Example structural verification (not a standalone test, but the pattern used in service tests):

```ts
// This must compile without errors
const track: SpotifyTrack = {
  id: "abc123",
  title: "Test Track",
  artist: "Test Artist",
  artists: ["Test Artist", "Featured Artist"],
  album: "Test Album",
  durationMs: 240000,
  isrc: "USAT21234567",
  uri: "spotify:track:abc123",
};

const info: TrackInfo = {
  title: track.title,
  artist: track.artist,
  album: track.album,
  durationMs: track.durationMs,
  isrc: track.isrc,
  uri: track.uri,
};

const result: MatchResult = {
  candidate: info,
  score: 0.95,
  confidence: "high",
  method: "isrc",
};

const tagConfig: LexiconTagConfig = {
  categoryName: "Spotify Playlists",
  color: "#1DB954",
};

const reviewStatus: ReviewStatus = "pending";
```

## Acceptance Criteria

- [ ] `src/types/common.ts` exports `TrackInfo`, `MatchResult`, `SyncPhase`, `DownloadStatus`, `MatchStatus`, `ReviewStatus` with exact field definitions
- [ ] `src/types/spotify.ts` exports `SpotifyPlaylist` and `SpotifyTrack` with exact field definitions
- [ ] `src/types/lexicon.ts` exports `LexiconTrack`, `LexiconTagCategory`, `LexiconTag`, `LexiconTagConfig` with exact field definitions
- [ ] `src/types/lexicon.ts` does NOT export `LexiconPlaylist` (removed -- Lexicon playlists are not used)
- [ ] `src/types/soulseek.ts` exports `SlskdFile`, `SlskdSearchResult`, `SlskdTransfer` with exact field definitions
- [ ] All optional fields are marked with `?` in TypeScript
- [ ] `MatchResult.confidence` is a string literal union, not a plain `string`
- [ ] `DownloadStatus` includes all seven states: pending, searching, downloading, validating, moving, done, failed
- [ ] `MatchStatus` includes all three states: pending, confirmed, rejected
- [ ] `ReviewStatus` includes all three states: pending, confirmed, rejected
- [ ] `SyncPhase` includes all three phases: match, review, download
- [ ] `SpotifyTrack.artists` is `string[]` (array), while `SpotifyTrack.artist` is `string` (single primary artist)
- [ ] `SlskdFile.length` is duration in seconds (number), not a string
- [ ] `LexiconTagConfig` has `categoryName: string` and `color: string` (both required)
- [ ] No runtime imports exist in any type file -- these are pure type definitions
- [ ] `pnpm lint` passes with all types in use
