---
# spec-17
title: API server
status: todo
type: task
priority: critical
parent: spec-E4
depends_on: spec-16
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

The API server module creates and configures the Hono application, mounts all route modules under `/api/*`, serves the web frontend's static assets in production, provides an SPA fallback, and starts the HTTP listener via `@hono/node-server`. It is the single entry point for the entire HTTP surface.

## Public Interface

```ts
export function createApp(): Hono
export function startServer(port: number): void
```

## Dependencies

| Import | Source |
|---|---|
| `Hono` | `hono` |
| `cors` | `hono/cors` |
| `serve` | `@hono/node-server` |
| `existsSync` | `node:fs` |
| `join` | `node:path` |
| `readFile` | `node:fs/promises` |
| `playlistRoutes` | `./routes/playlists.js` |
| `trackRoutes` | `./routes/tracks.js` |
| `matchRoutes` | `./routes/matches.js` |
| `downloadRoutes` | `./routes/downloads.js` |
| `statusRoutes` | `./routes/status.js` |
| `syncRoutes` | `./routes/sync.js` |
| `jobRoutes` | `./routes/jobs.js` |

## Behavior

### createApp()

Creates and returns a fully configured `Hono` instance.

1. **Instantiate** `new Hono()`.

2. **CORS middleware**: `app.use("/api/*", cors())` — applies to all `/api/*` routes with default CORS settings (allows all origins).

3. **Global error handler**: `app.onError((err, c) => ...)` — logs the error message to console as `[api] Error: {message}`, returns `c.json({ error: message }, 500)`.

4. **Route mounting** in this exact order:
   ```
   /api/playlists  -> playlistRoutes
   /api/tracks     -> trackRoutes
   /api/matches    -> matchRoutes
   /api/downloads  -> downloadRoutes
   /api/status     -> statusRoutes
   /api/sync       -> syncRoutes
   /api/jobs       -> jobRoutes
   ```

5. **Static file serving** (production only):
   - Computes `distDir = join(import.meta.dirname, "../../web/dist")`.
   - Only activates if `existsSync(distDir)` is true.
   - Registers a catch-all `app.get("*", ...)` handler:
     - Resolves request path: `"/"` maps to `"/index.html"`, all others used as-is.
     - Computes `filePath = join(distDir, reqPath)`.
     - If file exists: reads it via `readFile(filePath)`, determines Content-Type from extension, returns `c.body(content, 200, { "Content-Type": ... })`.
     - Content-Type map:
       | Extension | Content-Type |
       |---|---|
       | `html` | `text/html` |
       | `js` | `application/javascript` |
       | `css` | `text/css` |
       | `json` | `application/json` |
       | `svg` | `image/svg+xml` |
       | `png` | `image/png` |
       | `ico` | `image/x-icon` |
       | (other) | `application/octet-stream` |
     - **SPA fallback**: if file does not exist, reads `index.html` from distDir and returns it via `c.html(index)`. This allows client-side routing to work.

6. **Returns** the configured app.

### startServer(port)

1. Calls `createApp()` to get the Hono app.
2. Calls `serve({ fetch: app.fetch, port }, callback)` from `@hono/node-server`.
3. The callback logs: `"crate-sync API server listening on http://localhost:{port}"`.

### Port configuration

The `port` parameter is passed in by the caller (typically from `Config` or CLI flags). The server module itself does not read configuration — it receives the port as an argument.

## Error Handling

| Scenario | Behavior |
|---|---|
| Unhandled route handler error | Caught by `app.onError`, logged to console, returns `{ error: message }` with 500 |
| Static file not found (non-API path) | SPA fallback serves `index.html` |
| `web/dist/` directory missing | No static file handler registered; non-API GET requests fall through (likely 404 from Hono default) |
| `readFile` fails for static asset | Error propagates to `onError` handler (500 response) |
| Port already in use | `@hono/node-server`'s `serve()` throws; caller must handle |

## Tests

### Test approach

- Test `createApp()` by using Hono's `app.request()` method for in-process HTTP assertions (no actual server needed).
- Mock route modules if needed, but prefer integration tests that exercise real routes with mocked services.
- For static file serving tests: create a temporary `web/dist/` directory with test files.

### Key test scenarios

- **CORS**: verify `/api/*` requests include CORS headers
- **Error handler**: verify uncaught route errors return `{ error }` with 500
- **Route mounting**: verify all 7 route prefixes respond (e.g., `GET /api/status` returns 200)
- **Route mounting order**: verify no route shadowing (e.g., `/api/playlists/sync` is not caught by `/api/playlists/:id`)
- **Static files**: verify known file extensions return correct Content-Type
- **SPA fallback**: verify unknown path (e.g., `/dashboard/settings`) returns `index.html` content
- **Root path**: verify `GET /` returns `index.html` when dist exists
- **No dist directory**: verify non-API paths are not handled (no crash)
- **startServer**: verify `serve()` is called with correct port and fetch function

## Acceptance Criteria

- [ ] `createApp()` returns a `Hono` instance
- [ ] CORS middleware applied to `/api/*`
- [ ] Global `onError` handler returns `{ error: string }` with status 500 and logs to console
- [ ] All 7 route modules mounted at correct paths: `/api/playlists`, `/api/tracks`, `/api/matches`, `/api/downloads`, `/api/status`, `/api/sync`, `/api/jobs`
- [ ] Static file serving from `web/dist/` with correct Content-Type mapping (html, js, css, json, svg, png, ico, fallback to octet-stream)
- [ ] SPA fallback: non-API, non-static paths serve `index.html`
- [ ] Root path `/` serves `index.html`
- [ ] Static serving only activates when `web/dist/` directory exists
- [ ] `startServer(port)` creates app and starts `@hono/node-server` on given port
- [ ] Console log on successful server start with port number
