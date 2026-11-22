import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Opens libSQL (local file or Turso) and creates the parent folder of a local file. */
export function openDb(url: string, authToken?: string) {
  if (url.startsWith("file:")) {
    const path = url.slice("file:".length);
    if (path && path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function migrateDb(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
