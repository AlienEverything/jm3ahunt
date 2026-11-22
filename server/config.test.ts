import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devSecret, loadConfig } from "./config";

describe("dev secrets", () => {
  it("persists a generated secret and reuses it", () => {
    const file = join(mkdtempSync(join(tmpdir(), "jh-sec-")), "nested", "dev-secrets.json");
    const a = devSecret("SESSION_SECRET", file);
    const b = devSecret("SESSION_SECRET", file);
    const tag = devSecret("TAG_TOKEN_SECRET", file);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(tag).not.toBe(a);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ SESSION_SECRET: a, TAG_TOKEN_SECRET: tag });
  });

  it("production still requires real secrets", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });
});
