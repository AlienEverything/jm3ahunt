import { createAppServer } from "./app";

async function main() {
  const app = await createAppServer({ withNext: true });
  const port = await app.listen();
  console.log(`> Jm3a Hunt on http://localhost:${port} (${app.config.nodeEnv})`);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal}: saving matches and shutting down`);
    // Render sends SIGTERM and kills after ~30 s; never hang.
    setTimeout(() => process.exit(1), 10_000).unref();
    void app
      .close()
      .catch((err) => console.error("[server] shutdown error:", err instanceof Error ? err.message : err))
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
