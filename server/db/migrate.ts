// `npm run db:migrate`: applies drizzle/ migrations (the server also does this on boot).
import { loadConfig } from "../config";
import { migrateDb, openDb } from "./client";

const config = loadConfig();
const { db, client } = openDb(config.databaseUrl, config.databaseAuthToken);
migrateDb(db)
  .then(() => console.log("[db] migrations applied"))
  .catch((err) => {
    console.error("[db] migration failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => client.close());
