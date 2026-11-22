import { createAppServer } from "./app";

async function main() {
  const app = await createAppServer({ withNext: true });
  const port = await app.listen();
  console.log(`> Jm3a Hunt on http://localhost:${port} (${app.config.nodeEnv})`);

  const shutdown = () => {
    void app.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
