import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().optional(),
  DATABASE_URL: z.string().min(1).default("file:./data/jm3a.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  TAG_TOKEN_SECRET: z.string().min(32).optional(),
  ALLOW_SIM_GPS: boolFromEnv,
});

export interface AppConfig {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  port: number;
  appOrigin: string;
  databaseUrl: string;
  databaseAuthToken?: string;
  sessionSecret: string;
  tagTokenSecret: string;
  /** Simulated GPS and bots: only when ALLOW_SIM_GPS=true and not production. */
  allowSimGps: boolean;
}

type SecretName = "SESSION_SECRET" | "TAG_TOKEN_SECRET";
export const DEV_SECRETS_FILE = "data/dev-secrets.json";

/**
 * Development only: generated secrets are kept in data/dev-secrets.json (gitignored) so a
 * `tsx watch` restart does not invalidate tag tokens or anything else signed with them.
 */
export function devSecret(name: SecretName, file = DEV_SECRETS_FILE): string {
  let stored: Partial<Record<SecretName, string>> = {};
  try {
    stored = JSON.parse(readFileSync(file, "utf8")) as typeof stored;
  } catch {
    // first run or unreadable: generate below
  }
  const existing = stored[name];
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const value = randomBytes(32).toString("base64url");
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...stored, [name]: value }, null, 2));
  } catch {
    console.warn(`[config] could not write ${file}; ${name} is random for this process.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";

  const secret = (name: "SESSION_SECRET" | "TAG_TOKEN_SECRET"): string => {
    const value = e[name];
    if (value) return value;
    if (isProduction) throw new Error(`${name} is required in production (at least 32 characters).`);
    if (e.NODE_ENV === "development") return devSecret(name);
    console.warn(`[config] ${name} not set; using a random value for this process (anything signed with it stops working after a restart).`);
    return randomBytes(32).toString("base64url");
  };

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    appOrigin: e.APP_ORIGIN ?? `http://localhost:${e.PORT}`,
    databaseUrl: e.DATABASE_URL,
    databaseAuthToken: e.DATABASE_AUTH_TOKEN || undefined,
    sessionSecret: secret("SESSION_SECRET"),
    tagTokenSecret: secret("TAG_TOKEN_SECRET"),
    allowSimGps: e.ALLOW_SIM_GPS && !isProduction,
  };
}
