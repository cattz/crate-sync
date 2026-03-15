# slskd API Documentation

## Overview

- **Project**: slskd — Web UI/API for Soulseek
- **Framework**: ASP.NET Core, C#
- **Base URL**: `api/v0`
- **Auth**: JWT Bearer tokens (login via `POST /session`)
- **Source**: `slskd-src/src/slskd/`

---

## 1. Authentication & Session

### POST /session
**Login** — Obtain JWT token.
- **Auth**: None (AllowAnonymous)
- **Request Body**:
  - `username` (string, required)
  - `password` (string, required)
- **Response** (200): `{ token, tokenType: "Bearer", expires, issued, notBefore, name }`
- **Errors**: 400, 401

### GET /session
**Check Authentication** — Validates current token.
- **Auth**: Required
- **Response**: 200 OK | 401

### GET /session/enabled
**Check if Security Enabled** — Whether auth is required.
- **Auth**: None
- **Response** (200): `bool`

---

## 2. Server State & Management

### GET /server
**Get Server State** — Current Soulseek connection state.
- **Response** (200): `ServerState`

### PUT /server
**Connect to Server** — Initiate connection to Soulseek network.
- **Response**: 200 | 205 (already connecting, restarts retry loop) | 403

### DELETE /server
**Disconnect from Server**
- **Request Body**: string (disconnect message)
- **Response**: 204 | 403

---

## 3. Application Management

### GET /application
**Get Application State**
- **Response** (200): `State` object

### GET /application/version
**Get Current Version**
- **Response** (200): string (semver)

### GET /application/version/latest
**Check for Updates**
- **Query**: `forceCheck` (bool, optional)
- **Response** (200): Version info

### PUT /application
**Restart Application** (Admin only)
- **Response**: 204

### DELETE /application
**Shutdown Application** (Admin only)
- **Response**: 204

### POST /application/gc
**Trigger Garbage Collection**
- **Response**: 200

### GET /application/dump
**Memory Dump**
- **Response**: File (application/octet-stream)

### POST /application/loopback
**Loopback Test** — Echoes request body.
- **Response**: 200

---

## 4. Options & Configuration

### GET /options
**Get Current Options** (redacted)
- **Response** (200): `Options`

### GET /options/startup
**Get Startup Options**
- **Response** (200): `Options`

### PATCH /options
**Apply Configuration Overlay** (Admin, JWT only)
- **Request Body**: `OptionsOverlay`
- **Response** (200): `OptionsOverlay` | 400 | 403

### GET /options/debug
**Get Debug Configuration View** (Admin only)
- **Response** (200): string | 403

### GET /options/yaml/location
**Get YAML Config File Location** (Admin only)
- **Response** (200): string (absolute path)

### GET /options/yaml
**Get YAML Configuration File** (Admin only)
- **Response** (200): string

### PUT /options/yaml
**Update YAML Configuration** (Admin only)
- **Request Body**: string (YAML content)
- **Response**: 200 | 400

### POST /options/yaml/validate
**Validate YAML Configuration**
- **Request Body**: string (YAML content)
- **Response** (200): OK or error message

---

## 5. Logs

### GET /logs
**Get Application Logs**
- **Response** (200): Array of log entries

---

## 6. Searches

> **Concurrency**: Only one search request is processed at a time (semaphore). Additional requests return `429`.
> **Relay agents**: All search endpoints return `403 Forbidden` when running as a relay agent.

### POST /searches
**Start a Search**
- **Request Body** (`SearchRequest`):
  ```json
  {
    "id": "guid (optional, auto-generated if omitted)",
    "searchText": "string (required)",
    "searchTimeout": 15,
    "responseLimit": 100,
    "fileLimit": 10000,
    "filterResponses": true,
    "minimumPeerUploadSpeed": 0,
    "maximumPeerQueueLength": 1000000,
    "minimumResponseFileCount": 1
  }
  ```
  | Field | Type | Default | Notes |
  |-------|------|---------|-------|
  | `id` | Guid? | auto | Custom search ID |
  | `searchText` | string | *required* | Search query text |
  | `searchTimeout` | int? | 15 | Seconds, minimum 5 |
  | `responseLimit` | int? | 100 | Max peer responses |
  | `fileLimit` | int? | 10,000 | Max files in results |
  | `filterResponses` | bool? | true | Apply response filtering |
  | `minimumPeerUploadSpeed` | int? | 0 | Min peer upload speed (bytes/s) |
  | `maximumPeerQueueLength` | int? | 1,000,000 | Max peer queue depth |
  | `minimumResponseFileCount` | int? | 1 | Min files per response |
- **Response** (200): [`Search`](#search-object)
- **Errors**:
  - `400`: Malformed request or `ArgumentException` (e.g. empty search text)
  - `409`: `InvalidOperationException` (e.g. duplicate search)
  - `429`: Another search is already in progress
  - `500`: Unexpected error

### GET /searches
**List All Searches** — Returns all active and completed searches (without response details).
- **Response** (200): Array of [`Search`](#search-object)

### GET /searches/{id}
**Get Search by ID**
- **Path**: `id` (Guid)
- **Query**: `includeResponses` (bool, default false) — include full response data
- **Response** (200): [`Search`](#search-object)
- **Errors**: `404` — search not found

### GET /searches/{id}/responses
**Get Search Responses** — Returns only the responses array for a search.
- **Path**: `id` (Guid)
- **Response** (200): Array of [`Response`](#response-object)
- **Errors**: `404` — search not found

### PUT /searches/{id}
**Cancel Search** — Stop an in-progress search and collect results.
- **Path**: `id` (Guid)
- **Response**: `200` | `304` (search was not in progress) | `404`

### DELETE /searches/{id}
**Delete Search** — Remove from history.
- **Path**: `id` (Guid)
- **Response**: `204` | `404`

### Search Data Models

#### Search Object
```json
{
  "id": "guid",
  "searchText": "string",
  "token": 12345,
  "startedAt": "2024-01-01T00:00:00Z",
  "endedAt": "2024-01-01T00:00:15Z",
  "state": "Completed, ResponseReceived",
  "fileCount": 150,
  "lockedFileCount": 5,
  "responseCount": 12,
  "isComplete": true,
  "responses": [ /* Response objects, only if requested */ ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | Guid | Unique search identifier |
| `searchText` | string | The search query |
| `token` | int | Internal token |
| `startedAt` | DateTime | When the search started |
| `endedAt` | DateTime? | When the search ended |
| `state` | SearchStates (flags) | Current state (see below) |
| `fileCount` | int | Total files found across all responses |
| `lockedFileCount` | int | Total locked files found |
| `responseCount` | int | Number of peer responses |
| `isComplete` | bool | `true` if state includes `Completed` flag |
| `responses` | Response[] | Array of responses (only when `includeResponses=true`) |

**SearchStates** (flags enum from Soulseek library):
- `None`, `Requested`, `InProgress`, `Completed`, `ResponseReceived`, `Cancelled`, `TimedOut`, `Errored`

#### Response Object
```json
{
  "username": "peer_username",
  "token": 12345,
  "fileCount": 10,
  "lockedFileCount": 0,
  "hasFreeUploadSlot": true,
  "uploadSpeed": 1048576,
  "queueLength": 0,
  "files": [ /* File objects */ ],
  "lockedFiles": [ /* File objects */ ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `username` | string | Peer username |
| `token` | int | Response token |
| `fileCount` | int | Number of available files |
| `lockedFileCount` | int | Number of locked files |
| `hasFreeUploadSlot` | bool | Whether peer has free upload slot |
| `uploadSpeed` | int | Peer upload speed (bytes/s) |
| `queueLength` | long | Peer's upload queue length |
| `files` | File[] | Available files |
| `lockedFiles` | File[] | Locked files (need privilege) |

#### File Object
```json
{
  "filename": "@@user\\Music\\Artist - Title.flac",
  "extension": "flac",
  "size": 35000000,
  "code": 1,
  "bitRate": 320,
  "bitDepth": 16,
  "sampleRate": 44100,
  "length": 245,
  "isVariableBitRate": false,
  "isLocked": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filename` | string | Full file path on peer's system |
| `extension` | string | File extension |
| `size` | long | File size in bytes |
| `code` | int | File code |
| `bitRate` | int? | Bit rate (kbps) |
| `bitDepth` | int? | Bit depth |
| `sampleRate` | int? | Sample rate (Hz) |
| `length` | int? | Duration in seconds |
| `isVariableBitRate` | bool? | Whether VBR |
| `isLocked` | bool | Whether file requires privilege |

---

## 7. Transfers

> **Concurrency**: Download enqueue requests allow up to 2 concurrent operations. Additional requests return `429`.
> **Relay agents**: All transfer endpoints return `403 Forbidden` when running as a relay agent.

### Downloads

#### GET /transfers/downloads
**List All Downloads** — Grouped by user and directory.
- **Query**: `includeRemoved` (bool, default false)
- **Response** (200): Array of [`UserResponse`](#userresponse)

#### GET /transfers/downloads/{username}
**List Downloads by User**
- **Path**: `username` (URL-encoded)
- **Response** (200): [`UserResponse`](#userresponse)
- **Errors**: `404` — no downloads for user

#### GET /transfers/downloads/{username}/{id}
**Get Download Details**
- **Path**: `username` (URL-encoded), `id` (Guid string)
- **Response** (200): [`Transfer`](#transfer-object)
- **Errors**: `400` (invalid GUID) | `404` (not found)

#### GET /transfers/downloads/{username}/{id}/position
**Get Queue Position** — Requests current place in remote user's upload queue.
- **Path**: `username` (URL-encoded), `id` (Guid string)
- **Response** (200): [`Transfer`](#transfer-object) (with updated `placeInQueue`)
- **Errors**: `400` (invalid GUID) | `404` (not found) | `500`

#### POST /transfers/downloads/{username}
**Enqueue Downloads** — Queue files for download from a peer.
- **Path**: `username` (URL-encoded)
- **Request Body**: Array of `QueueDownloadRequest`
  ```json
  [
    { "filename": "@@user\\Music\\Artist - Title.flac", "size": 35000000 },
    { "filename": "@@user\\Music\\Artist - Title2.mp3", "size": 8500000 }
  ]
  ```
  | Field | Type | Description |
  |-------|------|-------------|
  | `filename` | string (required) | Full remote file path (from search results) |
  | `size` | long | File size in bytes |
- **Response** (201):
  ```json
  { "enqueued": 2, "failed": 0 }
  ```
- **Errors**:
  - `400`: Empty request, null records, or validation failure
  - `429`: Too many concurrent enqueue operations (max 2)
  - `500`: Unexpected error

#### DELETE /transfers/downloads/{username}/{id}
**Cancel Download**
- **Path**: `username` (URL-encoded), `id` (Guid string)
- **Query**: `remove` (bool, default false) — also remove from tracking
- **Response**: `204` | `400` (invalid GUID) | `404`

#### DELETE /transfers/downloads/all/completed
**Clear Completed Downloads** — Removes all completed transfers (succeeded, failed, cancelled, etc.).
- **Response**: `204` | `500`

### Uploads

#### GET /transfers/uploads
**List All Uploads** — Grouped by user and directory.
- **Query**: `includeRemoved` (bool, default false)
- **Response** (200): Array of [`UserResponse`](#userresponse)

#### GET /transfers/uploads/{username}
**List Uploads by User**
- **Path**: `username` (URL-encoded)
- **Response** (200): [`UserResponse`](#userresponse)
- **Errors**: `404` — no uploads for user

#### GET /transfers/uploads/{username}/{id}
**Get Upload Details**
- **Path**: `username` (URL-encoded), `id` (Guid string)
- **Response** (200): [`Transfer`](#transfer-object)
- **Errors**: `400` (invalid GUID) | `404`

#### DELETE /transfers/uploads/{username}/{id}
**Cancel Upload**
- **Path**: `username` (URL-encoded), `id` (Guid string)
- **Query**: `remove` (bool, default false)
- **Response**: `204` | `400` (invalid GUID) | `404`

#### DELETE /transfers/uploads/all/completed
**Clear Completed Uploads**
- **Response**: `204` | `500`

### Transfer Data Models

#### UserResponse
Response wrapper grouping transfers by user and directory.
```json
{
  "username": "peer_user",
  "directories": [
    {
      "directory": "@@peer_user\\Music\\Album",
      "fileCount": 3,
      "files": [ /* Transfer objects */ ]
    }
  ]
}
```

#### Transfer Object
```json
{
  "id": "sha1-hash-of-filename",
  "username": "peer_user",
  "filename": "@@peer_user\\Music\\Artist - Title.flac",
  "size": 35000000,
  "startOffset": 0,
  "direction": "Download",
  "state": "Completed, Succeeded",
  "token": 12345,
  "remoteToken": 54321,
  "startTime": "2024-01-01T00:00:00Z",
  "endTime": "2024-01-01T00:01:30Z",
  "bytesTransferred": 35000000,
  "bytesRemaining": 0,
  "averageSpeed": 388889,
  "percentComplete": 100.0,
  "elapsedTime": 90000,
  "remainingTime": 0,
  "placeInQueue": null,
  "ipEndPoint": "1.2.3.4:12345",
  "exception": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | SHA1 hash of filename |
| `username` | string | Peer username |
| `filename` | string | Remote file path |
| `size` | long | File size in bytes |
| `startOffset` | long | Starting byte offset |
| `direction` | string | `"Download"` or `"Upload"` |
| `state` | string | Transfer state flags (see below) |
| `token` | int | Local transfer token |
| `remoteToken` | int? | Remote peer's token |
| `startTime` | DateTime? | When transfer started |
| `endTime` | DateTime? | When transfer completed |
| `bytesTransferred` | long | Bytes transferred so far |
| `bytesRemaining` | long | Computed: `size - bytesTransferred` |
| `averageSpeed` | double | Average speed (bytes/s) |
| `percentComplete` | double | Progress 0.0–100.0 |
| `elapsedTime` | double? | Elapsed time (milliseconds) |
| `remainingTime` | double? | Projected remaining time (ms) |
| `placeInQueue` | int? | Position in remote queue |
| `ipEndPoint` | string | Remote IP:port |
| `exception` | string? | Error message if failed |

#### Transfer States
Flags enum — values can be combined (e.g. `"Completed, Succeeded"`).

| State Category | State Values | Numeric |
|----------------|-------------|---------|
| **Queued** | `Queued` | 2 |
| | `Queued, Locally` | 2050 |
| | `Queued, Remotely` | 4098 |
| **In Progress** | `Initializing` | 4 |
| | `InProgress` | 8 |
| **Successful** | `Completed, Succeeded` | 48 |
| **Failed** | `Completed, Cancelled` | 80 |
| | `Completed, TimedOut` | 144 |
| | `Completed, Errored` | 272 |
| | `Completed, Rejected` | 528 |
| | `Completed, Aborted` | 1040 |
| **Terminal** | `Completed` | 16 |

---

## 8. Users

### GET /users/{username}/endpoint
**Get User Endpoint** — IP address and port.
- **Response** (200): `IPEndPoint` | 404

### GET /users/{username}/status
**Get User Status** — Online status and mode.
- **Response** (200): `Status` | 404

### GET /users/{username}/info
**Get User Info** — Description, upload slots, etc.
- **Response** (200): `Info` | 404

### GET /users/{username}/browse
**Browse User Files** — Complete file listing (directory structure).
- **Response** (200): Array of `Directory` | 404

### GET /users/{username}/browse/status
**Get Browse Status** — Progress of ongoing browse.
- **Response** (200): decimal (0.0-1.0) | 404

### POST /users/{username}/directory
**Get Directory Contents**
- **Request Body** (`DirectoryContentsRequest`):
  - `directory` (string, required): Directory path
- **Response** (200): Array of `Directory` | 400 | 404

---

## 9. Shares

### GET /shares
**List All Shares** — Grouped by host.
- **Response** (200): `{ hostName: [Share] }`

### GET /shares/{id}
**Get Share by ID**
- **Response** (200): `Share` | 404

### GET /shares/contents
**Browse All Shares** — Directory structure of all shares.
- **Response** (200): Array of `Directory`

### GET /shares/{id}/contents
**Browse Specific Share**
- **Response** (200): Array of `Directory` | 404

### PUT /shares
**Rescan Shares** — Initiate share scan.
- **Response**: 204 | 409

### DELETE /shares
**Cancel Share Scan**
- **Response**: 204 | 404

---

## 10. Files

### Downloads Directory

#### GET /files/downloads/directories
**List Downloads Directory**
- **Query**: `recursive` (bool, optional)
- **Response** (200): `FilesystemDirectory`

#### GET /files/downloads/directories/{base64SubdirectoryName}
**List Downloads Subdirectory**
- **Path**: `base64SubdirectoryName` (base64-encoded relative path)
- **Query**: `recursive` (bool, optional)
- **Response** (200): `FilesystemDirectory` | 403 | 404

#### DELETE /files/downloads/directories/{base64SubdirectoryName}
**Delete Downloads Directory** (requires RemoteFileManagement)
- **Response**: 204 | 403 | 404

#### DELETE /files/downloads/files/{base64FileName}
**Delete Download File** (requires RemoteFileManagement)
- **Path**: `base64FileName` (base64-encoded relative path)
- **Response**: 204 | 403 | 404

### Incomplete Directory

#### GET /files/incomplete/directories
**List Incomplete Directory**
- **Query**: `recursive` (bool, optional)
- **Response** (200): `FilesystemDirectory`

#### GET /files/incomplete/directories/{base64SubdirectoryName}
**List Incomplete Subdirectory**
- **Response** (200): `FilesystemDirectory` | 403 | 404

#### DELETE /files/incomplete/directories/{base64SubdirectoryName}
**Delete Incomplete Directory**
- **Response**: 204 | 403 | 404

#### DELETE /files/incomplete/files/{base64FileName}
**Delete Incomplete File**
- **Response**: 204 | 403 | 404

---

## 11. Conversations (Private Messaging)

### GET /conversations
**List Conversations**
- **Query**: `includeInactive` (bool), `unAcknowledgedOnly` (bool)
- **Response** (200): Array of `Conversation`

### GET /conversations/{username}
**Get Conversation**
- **Query**: `includeMessages` (bool, optional)
- **Response** (200): `Conversation` | 404

### GET /conversations/{username}/messages
**Get Messages**
- **Query**: `unAcknowledgedOnly` (bool, optional)
- **Response** (200): Array of `PrivateMessage` | 404

### POST /conversations/{username}
**Send Private Message**
- **Request Body**: string (message text)
- **Response**: 201 | 400

### PUT /conversations/{username}
**Acknowledge All Messages** — Mark as read.
- **Response**: 200 | 404

### PUT /conversations/{username}/{id}
**Acknowledge Specific Message**
- **Response**: 200 | 404

### DELETE /conversations/{username}
**Close Conversation**
- **Response**: 204 | 404

---

## 12. Rooms (Chat)

### GET /rooms/available
**List Available Rooms** — Public, private, and owned.
- **Response** (200): Array of `RoomInfo`

### GET /rooms/joined
**List Joined Rooms**
- **Response** (200): Array of room names

### GET /rooms/joined/{roomName}
**Get Room Details**
- **Response** (200): `RoomResponse` | 404

### GET /rooms/joined/{roomName}/users
**Get Room Users**
- **Response** (200): Array of `UserData` | 404

### GET /rooms/joined/{roomName}/messages
**Get Room Messages**
- **Response** (200): Array of `RoomMessage` | 404

### POST /rooms/joined
**Join Room**
- **Request Body**: string (room name)
- **Response**: 201 | 200

### POST /rooms/joined/{roomName}/messages
**Send Room Message**
- **Request Body**: string (message text)
- **Response**: 201 | 404

### POST /rooms/joined/{roomName}/ticker
**Set Room Ticker**
- **Request Body**: string (ticker message)
- **Response**: 201 | 404

### POST /rooms/joined/{roomName}/members
**Add Private Room Member**
- **Request Body**: string (username)
- **Response**: 201 | 404

### DELETE /rooms/joined/{roomName}
**Leave Room**
- **Response**: 204 | 404

---

## 13. Events

### GET /events
**List Events** — Paginated application events.
- **Query**: `offset` (int, default 0), `limit` (int, default 100)
- **Response** (200): Array of `EventRecord`
- **Response Header**: `X-Total-Count`

### POST /events/{type}
**Raise Test Event**
- **Path**: `type` — One of: `DownloadFileComplete`, `DownloadDirectoryComplete`, `UploadFileComplete`, `PrivateMessageReceived`, `RoomMessageReceived`, `Noop`
- **Request Body**: string (optional disambiguator)
- **Response** (201): `Event` | 400

---

## 14. Telemetry — Metrics

### GET /telemetry/metrics
**Get Metrics** — Prometheus or JSON format.
- **Accept Header**:
  - `text/plain`: Prometheus format
  - `application/json`: JSON dictionary
- **Response** (200): Metrics data

### GET /telemetry/metrics/kpis
**Get KPIs** — Key performance indicators.
- **Response** (200): `{ metricName: PrometheusMetric }`

---

## 15. Telemetry — Reports

### GET /telemetry/reports/transfers/summary
**Transfer Summary** — Activity by state and direction.
- **Query**: `start` (DateTime), `end` (DateTime), `direction` ("Upload"|"Download"), `username` (string)
- **Response** (200): Dictionary of summaries | 400

### GET /telemetry/reports/transfers/histogram
**Transfer Histogram** — Activity in time intervals.
- **Query**: `start`, `end`, `interval` (int, min 5, default 60 minutes), `direction`, `username`
- **Response** (200): Nested dictionary | 400

### GET /telemetry/reports/transfers/leaderboard
**Transfer Leaderboard** — Top N users.
- **Query**: `direction` (required), `start`, `end`, `sortBy` ("Count"|"TotalBytes"|"AverageSpeed"), `sortOrder` ("ASC"|"DESC"), `limit` (default 25), `offset`
- **Response** (200): Array of `TransferSummary` | 400

### GET /telemetry/reports/transfers/users/{username}
**User Transfer Details**
- **Query**: `start`, `end`
- **Response** (200): Dictionary of upload/download summaries | 400

### GET /telemetry/reports/transfers/exceptions
**Transfer Exceptions** — Failures/errors.
- **Query**: `direction` (required), `start`, `end`, `username`, `sortOrder`, `limit`, `offset`
- **Response** (200): Array of `TransferExceptionDetail` | 400

### GET /telemetry/reports/transfers/exceptions/pareto
**Top Exceptions (Pareto)** — Most common by count.
- **Query**: `direction` (required), `start`, `end`, `username`, `limit`, `offset`
- **Response** (200): Array of `TransferExceptionSummary` | 400

### GET /telemetry/reports/transfers/directories
**Directory Download Frequency**
- **Query**: `start`, `end`, `username`, `limit`, `offset`
- **Response** (200): Array of `TransferDirectorySummary` | 400

---

## 16. Relay (Agent-Controller Communication)

### PUT /relay/agent
**Connect Agent to Controller** (Admin, JWT only)
- **Response**: 200 | 403

### DELETE /relay/agent
**Disconnect Agent** (Admin, JWT only)
- **Response**: 204 | 403

### GET /relay/controller/downloads/{token}
**Download from Controller** (API Key only)
- **Headers**: `X-Relay-Agent`, `X-Relay-Credential`, `X-Relay-Filename-Base64`
- **Response**: File stream (200) | 400 | 401 | 403

### POST /relay/controller/files/{token}
**Upload File to Controller** (API Key, ReadWrite+)
- **Headers**: `X-Relay-Agent`, `X-Relay-Credential`
- **Content-Type**: multipart/form-data (up to 10 TiB)
- **Response**: 200 | 400 | 401 | 403

### POST /relay/controller/shares/{token}
**Upload Shares to Controller** (API Key, ReadWrite+)
- **Headers**: `X-Relay-Agent`, `X-Relay-Credential`
- **Form Data**: `shares` (JSON), SQLite database file
- **Response**: 200 | 400 | 401 | 403

---

## Authentication Policies

| Policy | Description |
|--------|-------------|
| `AuthPolicy.Any` | JWT or anonymous (based on config) |
| `AuthPolicy.JwtOnly` | Valid JWT token required |
| `AuthPolicy.ApiKeyOnly` | API key required |
| `AuthRole.AdministratorOnly` | Administrator role required |
| `AuthRole.ReadWriteOrAdministrator` | ReadWrite or Administrator role |

## Common Patterns

- **Pagination**: `offset` + `limit` query params, `X-Total-Count` response header
- **Base64 Encoding**: File/directory paths in the Files API
- **URL Encoding**: Usernames in path parameters
- **Auth Header**: `Authorization: Bearer <token>`

## Key Data Models

| Model | Fields |
|-------|--------|
| `Transfer` | Id, Username, Filename, Size, State, Progress |
| `Search` | Id, SearchText, State, Responses (with File listings) |
| `Conversation` | Username, Messages, IsActive, HasUnAcknowledgedMessages |
| `Room` | RoomName, Users, Messages, IsPrivate, IsOwned |
| `Share` | Id, Host, Directories |
| `Event` | EventType, Timestamp, payload |
