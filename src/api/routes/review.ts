import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { ReviewService } from "../../services/review-service.js";

export const reviewRoutes = new Hono();

function getService() {
  const config = loadConfig();
  return ReviewService.fromDb(config);
}

// GET /api/review — list pending reviews, optional ?playlistId= filter
reviewRoutes.get("/", async (c) => {
  const svc = getService();
  const playlistId = c.req.query("playlistId");
  const pending = await svc.getPending(playlistId || undefined);
  return c.json(pending);
});

// GET /api/review/stats — review statistics
reviewRoutes.get("/stats", async (c) => {
  const svc = getService();
  const stats = await svc.getStats();
  return c.json(stats);
});

// POST /api/review/bulk — bulk confirm or reject
reviewRoutes.post("/bulk", async (c) => {
  const svc = getService();
  const body = await c.req.json<{ matchIds: string[]; action: "confirm" | "reject" }>();

  if (!body.matchIds || !Array.isArray(body.matchIds) || body.matchIds.length === 0) {
    return c.json({ error: "matchIds array is required" }, 400);
  }

  if (!["confirm", "reject"].includes(body.action)) {
    return c.json({ error: "action must be 'confirm' or 'reject'" }, 400);
  }

  if (body.action === "confirm") {
    const result = await svc.bulkConfirm(body.matchIds);
    return c.json(result);
  } else {
    const result = await svc.bulkReject(body.matchIds);
    return c.json(result);
  }
});

// POST /api/review/:id/confirm — confirm a match
reviewRoutes.post("/:id/confirm", async (c) => {
  const svc = getService();
  await svc.confirm(c.req.param("id"));
  return c.json({ ok: true });
});

// POST /api/review/:id/reject — reject a match (auto-queues download)
reviewRoutes.post("/:id/reject", async (c) => {
  const svc = getService();
  await svc.reject(c.req.param("id"));
  return c.json({ ok: true });
});
