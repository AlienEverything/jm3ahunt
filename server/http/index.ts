import { Hono } from "hono";
import type { AppConfig } from "../config";

/** REST API mounted under /api. Task 2 adds the real routes here. */
export function createApi(_config: AppConfig) {
  const api = new Hono().basePath("/api");

  api.get("/health", (c) => c.json({ ok: true, time: Date.now() }));

  api.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
  api.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
  });

  return api;
}
