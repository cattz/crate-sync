import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { playlistRoutes } from "./routes/playlists.js";
import { trackRoutes } from "./routes/tracks.js";
import { matchRoutes } from "./routes/matches.js";
import { downloadRoutes } from "./routes/downloads.js";
import { statusRoutes } from "./routes/status.js";
import { syncRoutes } from "./routes/sync.js";
import { jobRoutes } from "./routes/jobs.js";

export function createApp(): Hono {
  const app = new Hono();

  app.use("/api/*", cors());

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api] Error: ${message}`);
    return c.json({ error: message }, 500);
  });

  // API routes
  app.route("/api/playlists", playlistRoutes);
  app.route("/api/tracks", trackRoutes);
  app.route("/api/matches", matchRoutes);
  app.route("/api/downloads", downloadRoutes);
  app.route("/api/status", statusRoutes);
  app.route("/api/sync", syncRoutes);
  app.route("/api/jobs", jobRoutes);

  // Serve frontend static files in production
  const distDir = join(import.meta.dirname, "../../web/dist");
  if (existsSync(distDir)) {
    app.get("*", async (c) => {
      const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
      const filePath = join(distDir, reqPath);

      if (existsSync(filePath)) {
        const content = await readFile(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentType =
          {
            html: "text/html",
            js: "application/javascript",
            css: "text/css",
            json: "application/json",
            svg: "image/svg+xml",
            png: "image/png",
            ico: "image/x-icon",
          }[ext] ?? "application/octet-stream";
        return c.body(content, 200, { "Content-Type": contentType });
      }

      // SPA fallback
      const index = await readFile(join(distDir, "index.html"), "utf-8");
      return c.html(index);
    });
  }

  return app;
}

export function startServer(port: number): void {
  const app = createApp();

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`crate-sync API server listening on http://localhost:${info.port}`);
  });
}
