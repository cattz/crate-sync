# Lexicon DJ Local API Reference

Base URL: `http://localhost:48624/v1`

Enable in Lexicon settings under **Integrations**. No authentication (yet).

All query parameters can also be sent as a JSON body, even for GET requests.
Array parameters use repeated keys in query strings: `?fields=title&fields=artist`

All responses are wrapped: `{ "data": { ... } }`
Errors: `{ "message": "...", "errorCode": N }`

Error codes:
- `4` — Endpoint does not exist
- `5` — Validation error (missing/invalid parameter)
- `101` — Resource not found (e.g. PlaylistNotExist)

---

## Track Endpoints

### GET /track

Get one track by ID.

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | yes      | Track ID    |

**Response:** `{ "data": { "track": Track } }`

### PATCH /track

Update one track. Fields must be wrapped in an `edits` object.

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | yes      | Track ID    |
| `edits`   | object  | yes      | Object with writable Track fields |

**Example:**
```json
{ "id": 3326, "edits": { "title": "New Title", "tags": [23, 78] } }
```

**Response:** `{}` (empty on success)

### GET /tracks

Get all tracks from the library (paginated).

| Parameter | Type      | Required | Description |
|-----------|-----------|----------|-------------|
| `limit`   | integer   | no       | Max results (default: all) |
| `offset`  | integer   | no       | Skip N results (default: 0) |
| `fields`  | string[]  | no       | Restrict returned fields (e.g. `title`, `artist`). Base fields (`id`, `type`, `archived`, `location`) are always included. |
| `sort`    | string[]  | no       | Sort by field names (must be sent as JSON body array) |
| `order`   | string[]  | no       | Sort direction per sort field: `"asc"` or `"desc"` |

**Response:**
```json
{
  "data": {
    "total": 2014,
    "limit": 1,
    "offset": 0,
    "tracks": [ Track, ... ]
  }
}
```

### POST /tracks

Add new tracks to the library by file path.

| Parameter   | Type     | Required | Description |
|-------------|----------|----------|-------------|
| `locations` | string[] | yes      | File paths to add |

### DELETE /tracks

Delete tracks by ID.

| Parameter | Type      | Required | Description |
|-----------|-----------|----------|-------------|
| `ids`     | integer[] | yes      | Track IDs to delete |

---

## Playlist Endpoints

### GET /playlist

Get one playlist by ID, including its track IDs.

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | yes      | Playlist ID |

**Response:**
```json
{
  "data": {
    "playlist": {
      "id": 209,
      "name": "My Playlist",
      "dateAdded": "2026-03-07T17:04:54.753Z",
      "dateModified": "2026-03-07T17:04:54.753Z",
      "type": "2",
      "parentId": 1,
      "position": 1,
      "data": null,
      "trackIds": [5573, 5566, ...]
    }
  }
}
```

### POST /playlist

Create a new playlist.

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `name`    | string | yes      | Playlist name |

### PATCH /playlist

Update playlist metadata (name, position, etc.). Does **NOT** accept `trackIds` — use `PATCH /playlist-tracks` instead.

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | yes      | Playlist ID |
| `name`    | string  | no       | New name |

### GET /playlists

Get all playlists as a recursive tree.

**Response:**
```json
{
  "data": {
    "playlists": [
      {
        "id": 1,
        "name": "ROOT",
        "type": "1",
        "folderType": "1",
        "parentId": null,
        "position": 0,
        "playlists": [
          {
            "id": 30,
            "name": "DJPlaylists.fm",
            "type": "1",
            "folderType": "4",
            "playlists": []
          },
          {
            "id": 209,
            "name": "My Playlist",
            "type": "2",
            "parentId": 1,
            "position": 1
          }
        ]
      }
    ]
  }
}
```

### DELETE /playlists

Delete playlists by ID.

| Parameter | Type      | Required | Description |
|-----------|-----------|----------|-------------|
| `ids`     | integer[] | yes      | Playlist IDs to delete |

### PATCH /playlist-tracks

Add tracks to a playlist (appends). To replace all tracks, DELETE existing first then PATCH new ones.

| Parameter | Type      | Required | Description |
|-----------|-----------|----------|-------------|
| `id`      | integer   | yes      | Playlist ID |
| `trackIds`| integer[] | yes      | Track IDs to add |

**Note:** Does not support `positions` parameter.

### DELETE /playlist-tracks

Remove tracks from a playlist.

| Parameter | Type      | Required | Description |
|-----------|-----------|----------|-------------|
| `id`      | integer   | yes      | Playlist ID |
| `trackIds`| integer[] | yes      | Track IDs to remove |

---

## Custom Tag Endpoints

### GET /tags

Get all custom tags and tag categories.

**Response:**
```json
{
  "data": {
    "categories": [
      {
        "id": 1,
        "color": "#11A03C",
        "label": "Genre",
        "tags": [2, 6, 7, ...]
      }
    ],
    "tags": [
      {
        "id": 2,
        "categoryId": 1,
        "label": "House",
        "shortcut": null
      }
    ]
  }
}
```

### POST /tag

Create a new custom tag.

| Parameter    | Type    | Required | Description |
|--------------|---------|----------|-------------|
| `categoryId` | integer | yes      | Parent category ID |
| `label`      | string  | yes      | Tag label |

**Response:** `{ id, categoryId, label, position }` (not wrapped in `data`)

### PATCH /tag

Update an existing custom tag.

| Parameter    | Type    | Required | Description |
|--------------|---------|----------|-------------|
| `id`         | integer | yes      | Tag ID |
| `label`      | string  | no       | New label |
| `categoryId` | integer | no       | Move to different category |

**Response:** `{ id, categoryId, label, position }` (not wrapped in `data`)

### DELETE /tag

Delete a custom tag by ID.

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | yes      | Tag ID |

**Response:** `{}`

### POST /tag-category

Create a new tag category.

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `label`   | string | yes      | Category label |
| `color`   | string | no       | Hex color (e.g. `"#9B59B6"`) |

**Response:** `{ id, label, position, color, tags: [] }` (not wrapped in `data`)

### PATCH /tag-category

Update an existing tag category.

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | yes      | Category ID |
| `label`   | string  | no       | New label |
| `color`   | string  | no       | New hex color |

**Response:** `{}`

### DELETE /tag-category

Delete a tag category **and all tags in it**.

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | yes      | Category ID |

**Response:** `{}`

### Assigning Tags to Tracks

Tags are set via `PATCH /track` using the **`edits` wrapper**:

```json
{ "id": 3326, "edits": { "tags": [23, 78, 80] } }
```

**Important**: This **replaces** the entire tags array — it is NOT additive. To add a tag, read the track's current tags first, append the new ID(s), then write back the full array.

---

## Control Endpoint

### POST /control

Run Lexicon commands.

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `action`  | string | yes      | Control action name |

---

## Music Player Endpoints

### GET /playing

Get the currently playing track.

**Response:**
```json
{
  "data": {
    "track": null,
    "progress": 0,
    "currentTime": 0
  }
}
```

### GET /queue

Get queued tracks.

**Response:**
```json
{
  "data": {
    "tracks": []
  }
}
```

---

## Schemas

### Track

| Field              | Type         | Description |
|--------------------|--------------|-------------|
| `id`               | integer      | Track ID |
| `type`             | string       | Track type (`"0"` = file) |
| `archived`         | integer      | 0 = active, 1 = archived |
| `location`         | string       | Full file path |
| `locationUnique`   | string       | Lowercase normalized path |
| `title`            | string       | Track title |
| `artist`           | string       | Artist name |
| `albumTitle`       | string       | Album title |
| `label`            | string       | Record label |
| `remixer`          | string       | Remixer name |
| `mix`              | string       | Mix version |
| `composer`         | string       | Composer |
| `producer`         | string       | Producer |
| `grouping`         | string       | Grouping tag |
| `lyricist`         | string       | Lyricist |
| `comment`          | string       | Comment field |
| `key`              | string       | Musical key (e.g. `"6A"`) |
| `genre`            | string       | Genre |
| `bpm`              | float        | BPM |
| `rating`           | integer      | Rating (0-5) |
| `color`            | string       | Color label |
| `year`             | integer      | Release year |
| `duration`         | float        | Duration in seconds |
| `bitrate`          | integer      | Bitrate in kbps |
| `playCount`        | integer      | Play count |
| `lastPlayed`       | string\|null | ISO datetime or null |
| `dateAdded`        | string       | ISO datetime |
| `dateModified`     | string       | ISO datetime |
| `sizeBytes`        | integer      | File size in bytes |
| `sampleRate`       | integer      | Sample rate in Hz |
| `trackNumber`      | integer      | Track number on album |
| `energy`           | integer      | Energy level (0-10) |
| `danceability`     | integer      | Danceability (0-10) |
| `popularity`       | integer      | Popularity (0-10) |
| `happiness`        | integer      | Happiness (0-10) |
| `extra1`           | string       | Custom field 1 |
| `extra2`           | string       | Custom field 2 |
| `importSource`     | string       | Import source ID |
| `incoming`         | integer      | 0 or 1 |
| `archivedSince`    | string\|null | ISO datetime or null |
| `beatshiftCase`    | string       | Beatshift case |
| `fingerprint`      | string       | Audio fingerprint hash |
| `streamingService` | string\|null | Streaming service name |
| `streamingId`      | string\|null | Streaming service track ID |
| `data`             | object\|null | Additional metadata |
| `tags`             | integer[]    | Array of tag IDs |
| `cuepoints`        | Cuepoint[]   | Array of cuepoints |
| `tempomarkers`     | Tempomarker[]| Array of tempo markers |

### Playlist

| Field          | Type          | Description |
|----------------|---------------|-------------|
| `id`           | integer       | Playlist ID |
| `name`         | string        | Playlist name |
| `dateAdded`    | string        | ISO datetime |
| `dateModified` | string        | ISO datetime |
| `type`         | string        | `"1"` = folder, `"2"` = playlist |
| `folderType`   | string\|null  | Folder type (folders only) |
| `parentId`     | integer\|null | Parent playlist/folder ID |
| `position`     | integer       | Position in parent |
| `data`         | object\|null  | Additional metadata |
| `trackIds`     | integer[]     | Track IDs (when fetched via GET /playlist) |
| `playlists`    | Playlist[]    | Child playlists (when fetched via GET /playlists tree) |

### Cuepoint

| Field        | Type        | Description |
|--------------|-------------|-------------|
| `id`         | integer     | Cuepoint ID |
| `trackId`    | integer     | Parent track ID |
| `name`       | string      | Cue name |
| `type`       | string      | Cue type (`"1"` = hot cue) |
| `startTime`  | float       | Start time in seconds |
| `endTime`    | float\|null | End time (null if not a loop) |
| `position`   | integer     | Cue slot position |
| `color`      | string      | Color name (e.g. `"red"`) |
| `activeLoop` | boolean     | Whether this is an active loop |
| `data`       | object\|null| Additional metadata |

### Tempomarker

| Field       | Type         | Description |
|-------------|--------------|-------------|
| `id`        | integer      | Tempomarker ID |
| `trackId`   | integer      | Parent track ID |
| `startTime` | float        | Start time in seconds |
| `bpm`       | integer      | BPM at this point |
| `data`      | object       | Additional metadata |

### Custom Tag

| Field        | Type         | Description |
|--------------|--------------|-------------|
| `id`         | integer      | Tag ID |
| `categoryId` | integer     | Parent category ID |
| `label`      | string       | Tag label |
| `shortcut`   | string\|null | Keyboard shortcut |

### Custom Tag Category

| Field   | Type      | Description |
|---------|-----------|-------------|
| `id`    | integer   | Category ID |
| `color` | string    | Hex color (e.g. `"#11A03C"`) |
| `label` | string    | Category label |
| `tags`  | integer[] | Tag IDs in this category |

---

## Notes for crate-sync

- All IDs are **integers**, not strings. Our `LexiconService` normalizes with `String(id)`.
- `duration` is in **seconds** (not milliseconds). Multiply by 1000 for `durationMs`.
- `albumTitle` not `album` — our normalizer maps this.
- Track list response is `{ data: { total, limit, offset, tracks: [...] } }` — nested inside `data`.
- Single track response is `{ data: { track: {...} } }` — also nested.
- Playlists tree response is `{ data: { playlists: [...] } }`.
- The `fields` parameter filters output but always includes `id`, `type`, `archived`, `location`.
- `sort`/`order` must be arrays (JSON body only, not query string).
- `/search/tracks` and `/playlist-by-path` endpoints listed in Swagger docs do **not exist** in current version.
- DELETE for single track (`DELETE /track`) does not exist; use `DELETE /tracks` with `ids` array.
