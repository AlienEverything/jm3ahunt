import type { AppConfig } from "./config";
import { migrateDb, openDb, type Db } from "./db/client";
import { Registry } from "./engine/registry";
import { createStore, type Store } from "./engine/store";
import { createLimits, type Limits } from "./security/rateLimit";

/** Everything the HTTP and WS layers share. `now` is injectable so tests drive time. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  store: Store;
  registry: Registry;
  limits: Limits;
  now: () => number;
  close(): Promise<void>;
}

export async function createContext(config: AppConfig, now: () => number = Date.now): Promise<AppContext> {
  const { db, client } = openDb(config.databaseUrl, config.databaseAuthToken);
  await migrateDb(db);
  const store = createStore(db);
  const limits = createLimits(now);
  const registry = new Registry({ now, store, tagSecret: config.tagTokenSecret, allowSim: config.allowSimGps, captureLimiter: limits.capture });
  await registry.restoreAll();
  return {
    config,
    db,
    store,
    registry,
    limits,
    now,
    async close() {
      await registry.shutdown();
      client.close();
    },
  };
}
