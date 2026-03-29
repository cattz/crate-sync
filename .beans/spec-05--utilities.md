---
# spec-05
title: Utility modules
status: todo
type: task
priority: critical
parent: spec-E0
depends_on: spec-01
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

# spec-05: Utility modules

## Purpose

Define the complete interface, behavior, and test cases for the five utility modules in `src/utils/`. These are foundational building blocks used throughout crate-sync: a structured file logger, an exponential backoff retry wrapper, a terminal progress bar, a graceful shutdown handler, and a Spotify URL/ID parser.

---

## Module 1: Logger (`src/utils/logger.ts`)

### Purpose

A lightweight structured logger that writes timestamped, level-tagged, context-scoped log lines to a file. The logger does **not** write to stdout/stderr -- it is file-only. Console output is handled separately by the CLI commands.

### Public Interface

```ts
type LogLevel = "debug" | "info" | "warn" | "error";

export function setLogLevel(level: LogLevel): void;
export function setLogFile(path: string): void;
export function closeLog(): void;
export function createLogger(context: string): {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
};
```

### Dependencies

- `node:fs` -- `createWriteStream`, `mkdirSync`
- `node:path` -- `dirname`

### Behavior

#### Log levels and numeric ordering

| Level | Numeric Value |
|---|---|
| `debug` | 0 |
| `info` | 1 |
| `warn` | 2 |
| `error` | 3 |

The module maintains a module-level `currentLevel` variable, initialized to `LEVELS.info` (1).

#### `setLogLevel(level: LogLevel): void`

Sets the minimum log level. Messages below this level are silently discarded. Updates the module-level `currentLevel` to `LEVELS[level]`.

#### `setLogFile(path: string): void`

Opens a write stream in append mode (`flags: "a"`) to the given file path. Creates the parent directory recursively if it does not exist (`mkdirSync(dirname(path), { recursive: true })`). Stores the stream in the module-level `fileStream` variable. If called again, the previous stream is **not** closed -- the caller should call `closeLog()` first.

#### `closeLog(): void`

Calls `fileStream?.end()` to flush and close the file stream, then sets `fileStream = null`.

#### `createLogger(context: string)`

Returns an object with four methods (`debug`, `info`, `warn`, `error`). Each method calls the internal `write()` function with the corresponding level, the given context string, the message, and optional data.

#### Internal `write(level, context, message, data?)` function

```ts
function write(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel) return;

  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.toUpperCase().padEnd(5)}] [${context}]`;
  const line = data
    ? `${prefix} ${message} ${JSON.stringify(data)}`
    : `${prefix} ${message}`;

  if (fileStream) {
    fileStream.write(line + "\n");
  }
}
```

**Line format:** `2026-03-24T12:00:00.000Z [INFO ] [spotify] Fetching playlists {"count":10}`

- Timestamp: ISO 8601 format.
- Level: uppercase, padded to 5 characters with spaces on the right.
- Context: wrapped in square brackets.
- Data: JSON-stringified, appended after the message if present.
- Each line ends with `\n`.
- If `fileStream` is null (no log file set), the message is silently discarded.

### Error Handling

- If the log file directory cannot be created, `mkdirSync` throws.
- If the log file cannot be opened for writing, `createWriteStream` throws.
- Write errors on the stream are silently ignored (Node.js stream default behavior).

### Tests

#### Test: write discards messages below current level

```
Setup:   setLogLevel("warn")
Input:   logger.info("should be discarded")
Output:  Nothing written to the file stream
```

#### Test: write formats line with timestamp, level, context, and message

```
Setup:   setLogLevel("debug"), setLogFile("/tmp/test.log")
Input:   createLogger("test").info("hello world")
Output:  Line matching pattern: /^\d{4}-.*\[INFO \] \[test\] hello world$/
```

#### Test: write appends JSON data when provided

```
Setup:   setLogLevel("debug"), setLogFile("/tmp/test.log")
Input:   createLogger("test").info("hello", { key: "value" })
Output:  Line ending with: hello {"key":"value"}
```

#### Test: closeLog ends the file stream

```
Setup:   setLogFile("/tmp/test.log")
Input:   closeLog()
Output:  fileStream is null, subsequent writes are no-ops
```

---

## Module 2: Retry (`src/utils/retry.ts`)

### Purpose

Provide an exponential-backoff retry wrapper for async operations, with jitter to prevent thundering herd. Includes a default predicate for identifying retryable network/server errors.

### Public Interface

```ts
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
}

export function isRetryableError(error: unknown): boolean;
export function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
```

### Dependencies

None (only built-in `setTimeout` via `Promise`).

### Behavior

#### `isRetryableError(error: unknown): boolean`

Returns `true` if the error is likely a transient failure worth retrying:

1. If `error instanceof TypeError` -- returns `true`. (`fetch()` throws `TypeError` on network failures like DNS resolution, connection refused, etc.)
2. If `error instanceof Error` and `error.message` matches:
   - HTTP status codes: `/\b(429|500|502|503|504)\b/` -- returns `true`.
   - Network error keywords: `/\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed)\b/i` -- returns `true`.
3. Otherwise, returns `false`.

#### `withRetry<T>(fn, options?): Promise<T>`

**Default option values:**

| Option | Default |
|---|---|
| `maxRetries` | `3` |
| `baseDelayMs` | `1000` (1 second) |
| `maxDelayMs` | `10000` (10 seconds) |
| `retryOn` | `isRetryableError` |

**Algorithm:**

1. Loop from `attempt = 0` to `attempt = maxRetries` (inclusive, so up to `maxRetries + 1` total calls).
2. Call `fn()` and await the result.
3. If `fn()` resolves, return the result immediately.
4. If `fn()` rejects:
   a. Store the error as `lastError`.
   b. If `attempt >= maxRetries` OR `retryOn(error)` returns `false`, re-throw the error immediately.
   c. Compute delay: `Math.min(baseDelayMs * 2^attempt + Math.random() * baseDelayMs, maxDelayMs)`.
   d. Log to stderr: `[retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms...`.
   e. Wait for `delay` milliseconds.
5. After the loop, throw `lastError` (unreachable in practice, satisfies TypeScript).

**Delay formula:**

```
exponentialDelay = baseDelayMs * 2^attempt
jitter = Math.random() * baseDelayMs
delay = min(exponentialDelay + jitter, maxDelayMs)
```

For defaults (baseDelayMs=1000, maxDelayMs=10000):
- Attempt 0 failure: delay = min(1000 + rand*1000, 10000) = ~1000-2000ms
- Attempt 1 failure: delay = min(2000 + rand*1000, 10000) = ~2000-3000ms
- Attempt 2 failure: delay = min(4000 + rand*1000, 10000) = ~4000-5000ms
- Attempt 3: no retry (maxRetries=3 exhausted, throw)

### Error Handling

- Non-retryable errors are thrown immediately on first failure (no retry).
- After exhausting all retries, the last error is thrown.
- The `retryOn` predicate receives the raw `unknown` error and must handle all types.

### Tests

#### Test: returns result on first success

```
Input:   fn resolves with "ok" on first call
Output:  Returns "ok"
Assert:  fn called exactly 1 time
```

#### Test: retries on failure then succeeds

```
Input:   fn rejects with TypeError("fetch failed") twice, then resolves with "recovered"
Output:  Returns "recovered"
Assert:  fn called exactly 3 times
```

#### Test: throws after maxRetries exhausted

```
Input:   fn always rejects with TypeError("fetch failed"), maxRetries=2
Output:  Rejects with TypeError("fetch failed")
Assert:  fn called exactly 3 times (1 initial + 2 retries)
```

#### Test: respects custom retryOn predicate

```
Input:   fn rejects with Error("CUSTOM_RETRYABLE") once, then resolves with "ok"
         retryOn returns true for "CUSTOM_RETRYABLE" messages
Output:  Returns "ok"
Assert:  fn called exactly 2 times, retryOn called with the custom error
```

#### Test: does not retry on non-retryable errors

```
Input:   fn rejects with Error("FATAL: invalid input")
Output:  Rejects with Error("FATAL: invalid input")
Assert:  fn called exactly 1 time (no retry)
```

#### Test: isRetryableError returns true for TypeError

```
Input:   new TypeError("fetch failed")
Output:  true
```

#### Test: isRetryableError returns true for HTTP 429/500/502/503/504

```
Input:   new Error("HTTP 429 Too Many Requests")
Output:  true

Input:   new Error("Status 503")
Output:  true
```

#### Test: isRetryableError returns true for network error keywords

```
Input:   new Error("ECONNREFUSED")
Output:  true

Input:   new Error("ETIMEDOUT")
Output:  true
```

#### Test: isRetryableError returns false for non-retryable errors

```
Input:   new Error("Invalid argument")
Output:  false

Input:   "string error"
Output:  false
```

---

## Module 3: Progress (`src/utils/progress.ts`)

### Purpose

A minimal terminal progress bar that renders a single line with a label, a filled/empty block bar, percentage, and status text. The line overwrites itself on each tick using `\r`.

### Public Interface

```ts
export class Progress {
  constructor(total: number, label?: string);
  tick(message?: string): void;
}
```

### Dependencies

- `chalk` -- for colored output (`chalk.cyan`, `chalk.green`, `chalk.gray`)

### Behavior

#### Constructor

```ts
constructor(total: number, label: string = "")
```

- Stores `total` and `label` as private fields.
- Initializes private `current` to `0`.

#### `tick(message?: string): void`

1. Increments `current` by 1.
2. Computes percentage: `Math.round((current / total) * 100)`.
3. Renders a progress bar via `renderBar(pct)`.
4. Computes status text: if `message` is provided, use it; otherwise use `"${current}/${total}"`.
5. Writes to `process.stdout` using `\r` to overwrite the current line:
   ```
   \r<cyan label> <bar> <pct>% <status>
   ```
   (Note: two trailing spaces to clear any previous longer text.)
6. If `current >= total`, writes `\n` to move to the next line.

#### `renderBar(pct: number): string` (private)

1. Bar width: 20 characters.
2. Filled characters: `Math.round((pct / 100) * 20)` using the Unicode full block `\u2588` in green (`chalk.green`).
3. Empty characters: `20 - filled` using the Unicode light shade `\u2591` in gray (`chalk.gray`).
4. Returns the concatenated string.

### Error Handling

No error handling needed. If `total` is 0, division by zero produces `NaN`/`Infinity` but does not crash.

### Tests

#### Test: tick increments current counter

```
Input:   new Progress(10, "test"); tick() called 3 times
Output:  Internal current is 3 (verify via stdout output showing "3/10")
```

#### Test: tick prints newline when total is reached

```
Input:   new Progress(2, "test"); tick(); tick()
Output:  Second tick writes \n to stdout
```

#### Test: tick uses custom message when provided

```
Input:   new Progress(10, "test"); tick("custom msg")
Output:  stdout contains "custom msg" (not "1/10")
```

#### Test: renderBar produces correct proportions

```
Input:   Progress with total=100, after 50 ticks
Output:  Bar has 10 green blocks and 10 gray blocks (50% of 20-width bar)
```

---

## Module 4: Shutdown (`src/utils/shutdown.ts`)

### Purpose

Provide a graceful shutdown mechanism that catches `SIGINT` (Ctrl+C), runs registered cleanup functions, and exits cleanly. A second `SIGINT` force-quits.

### Public Interface

```ts
export function isShutdownRequested(): boolean;
export function onShutdown(fn: () => void | Promise<void>): void;
export function setupShutdownHandler(): void;
```

### Dependencies

None (uses `process` global).

### Behavior

#### Module-level state

```ts
let shutdownRequested = false;
const cleanupFns: (() => void | Promise<void>)[] = [];
```

#### `isShutdownRequested(): boolean`

Returns the current value of `shutdownRequested`. Used by long-running loops to check if they should stop.

#### `onShutdown(fn: () => void | Promise<void>): void`

Pushes `fn` onto the `cleanupFns` array. The function will be called (in registration order) when shutdown is triggered.

#### `setupShutdownHandler(): void`

Registers a `SIGINT` handler on `process`:

1. **First SIGINT:**
   - Sets `shutdownRequested = true`.
   - Prints `"\nGracefully shutting down... (press Ctrl+C again to force)"` to stdout.
   - Iterates through `cleanupFns` in order, calling each one and awaiting it.
   - Errors from cleanup functions are caught and silently ignored (`try/catch` with empty `catch`).
   - After all cleanup functions complete, calls `process.exit(0)`.

2. **Second SIGINT** (while first is still running):
   - Since `shutdownRequested` is already `true`, the handler detects this.
   - Prints `"\nForce quitting..."` to stdout.
   - Calls `process.exit(1)` immediately.

### Error Handling

- Cleanup function errors are silently ignored during shutdown.
- If a cleanup function hangs, the user can press Ctrl+C again to force-quit with exit code 1.

### Tests

#### Test: isShutdownRequested returns false initially

```
Input:   Call isShutdownRequested() before any shutdown
Output:  false
```

#### Test: onShutdown registers cleanup functions

```
Input:   Register 3 cleanup functions, then trigger SIGINT
Output:  All 3 functions are called in registration order
```

#### Test: setupShutdownHandler handles first SIGINT gracefully

```
Input:   Register a cleanup fn, setup handler, send SIGINT
Output:  - shutdownRequested becomes true
         - Cleanup fn is called
         - process.exit(0) is called
```

#### Test: setupShutdownHandler handles second SIGINT as force quit

```
Input:   Setup handler, send SIGINT, then send SIGINT again while cleanup is running
Output:  process.exit(1) is called
```

#### Test: cleanup errors are silently ignored

```
Input:   Register a cleanup fn that throws, setup handler, send SIGINT
Output:  No unhandled error, process.exit(0) still called
```

---

## Module 5: Spotify URL (`src/utils/spotify-url.ts`)

### Purpose

Extract a Spotify playlist ID from various input formats: a full `open.spotify.com` URL (with or without query parameters), or a bare playlist ID string. This allows users to paste either format when specifying playlists.

### Public Interface

```ts
export function extractPlaylistId(input: string): string;
```

### Dependencies

None (uses the built-in `URL` constructor).

### Behavior

#### `extractPlaylistId(input: string): string`

1. Trim whitespace from `input`.
2. If the trimmed string is empty, return it as-is (empty string).
3. Attempt to parse the trimmed string as a URL using `new URL(trimmed)`:
   - If parsing succeeds AND `url.hostname === "open.spotify.com"` AND `url.pathname.startsWith("/playlist/")`:
     - Extract the ID: `url.pathname.replace("/playlist/", "")`.
     - If the extracted ID is non-empty, return it.
     - If the extracted ID is empty, return the original trimmed input.
   - If parsing succeeds but the URL is not a Spotify playlist URL, fall through to step 4.
   - If parsing throws (not a valid URL), the error is caught and ignored.
4. Return the trimmed input as-is (assume it is a bare playlist ID).

#### Supported input formats

| Input | Output |
|---|---|
| `"37i9dQZF1DXcBWIGoYBM5M"` | `"37i9dQZF1DXcBWIGoYBM5M"` |
| `"  37i9dQZF1DXcBWIGoYBM5M  "` | `"37i9dQZF1DXcBWIGoYBM5M"` |
| `"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"` | `"37i9dQZF1DXcBWIGoYBM5M"` |
| `"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123"` | `"37i9dQZF1DXcBWIGoYBM5M"` |
| `""` | `""` |
| `"   "` | `""` |
| `"https://example.com/playlist/abc"` | `"https://example.com/playlist/abc"` |
| `"https://open.spotify.com/track/abc123"` | `"https://open.spotify.com/track/abc123"` |

### Error Handling

- Invalid URL strings (that cause `new URL()` to throw) are handled gracefully via a try/catch -- the input is returned as-is.
- No errors are thrown by this function.

### Tests

#### Test: extracts ID from a full Spotify URL

```
Input:   "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
Output:  "37i9dQZF1DXcBWIGoYBM5M"
```

#### Test: extracts ID from a URL with query params

```
Input:   "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123"
Output:  "37i9dQZF1DXcBWIGoYBM5M"
```

#### Test: returns a bare ID as-is

```
Input:   "37i9dQZF1DXcBWIGoYBM5M"
Output:  "37i9dQZF1DXcBWIGoYBM5M"
```

#### Test: returns empty string for empty input

```
Input:   ""
Output:  ""

Input:   "   "
Output:  ""
```

#### Test: trims whitespace from input

```
Input:   "  37i9dQZF1DXcBWIGoYBM5M  "
Output:  "37i9dQZF1DXcBWIGoYBM5M"
```

#### Test: returns non-Spotify URLs as-is

```
Input:   "https://example.com/playlist/abc"
Output:  "https://example.com/playlist/abc"
```

#### Test: returns non-playlist Spotify URLs as-is

```
Input:   "https://open.spotify.com/track/abc123"
Output:  "https://open.spotify.com/track/abc123"
```

---

## Acceptance Criteria

### Logger
- [ ] `setLogLevel()` accepts `"debug" | "info" | "warn" | "error"` and filters messages below the threshold
- [ ] `setLogFile()` opens an append-mode write stream and creates parent directories
- [ ] `closeLog()` ends the file stream and sets it to null
- [ ] `createLogger()` returns an object with `debug`, `info`, `warn`, `error` methods
- [ ] Log line format: `<ISO timestamp> [<LEVEL padded to 5>] [<context>] <message> [<JSON data>]`
- [ ] Messages are discarded (not written) when no file stream is set
- [ ] Default log level is `info`

### Retry
- [ ] `withRetry()` calls `fn` up to `maxRetries + 1` times (1 initial + N retries)
- [ ] Default options: maxRetries=3, baseDelayMs=1000, maxDelayMs=10000, retryOn=isRetryableError
- [ ] Delay uses exponential backoff with jitter: `min(baseDelayMs * 2^attempt + random * baseDelayMs, maxDelayMs)`
- [ ] `isRetryableError()` returns true for TypeError, HTTP 429/500/502/503/504, and network error keywords
- [ ] `isRetryableError()` returns false for non-Error values and unrecognized error messages
- [ ] Non-retryable errors are thrown immediately without waiting
- [ ] Custom `retryOn` predicate is respected when provided

### Progress
- [ ] Constructor accepts `total: number` and optional `label: string` (default `""`)
- [ ] `tick()` increments the counter, renders a 20-character-wide progress bar, and overwrites the line with `\r`
- [ ] `tick()` prints `\n` when `current >= total`
- [ ] `tick(message)` uses the provided message instead of the default `"current/total"` format
- [ ] Bar uses `chalk.green` for filled blocks and `chalk.gray` for empty blocks, label in `chalk.cyan`

### Shutdown
- [ ] `isShutdownRequested()` returns `false` initially and `true` after first SIGINT
- [ ] `onShutdown()` registers cleanup functions that run in order on SIGINT
- [ ] First SIGINT: runs all cleanup functions, prints graceful message, exits with code 0
- [ ] Second SIGINT: prints force-quit message, exits with code 1
- [ ] Cleanup function errors are silently ignored (try/catch with empty catch)

### Spotify URL
- [ ] `extractPlaylistId()` extracts ID from `https://open.spotify.com/playlist/<id>` URLs
- [ ] Query parameters (e.g., `?si=...`) are stripped from the URL before extraction
- [ ] Bare playlist IDs are returned as-is
- [ ] Input is trimmed of leading/trailing whitespace
- [ ] Empty/whitespace-only input returns empty string
- [ ] Non-Spotify URLs and non-playlist Spotify URLs are returned as-is
- [ ] Invalid URL strings do not throw (caught internally)
