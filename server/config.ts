import { randomBytes } from "node:crypto";
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
