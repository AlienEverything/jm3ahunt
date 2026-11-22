import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Own port, temp DB and simulated GPS; never touches data/jm3a.db. Stop `npm run dev` first:
// Next allows one dev server per project directory.
const PORT = 3100;
const db = join(tmpdir(), `jh-e2e-${Date.now()}.db`).replace(/\\/g, "/");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx server/index.ts",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "development",
      PORT: String(PORT),
      APP_ORIGIN: `http://localhost:${PORT}`,
      DATABASE_URL: `file:${db}`,
      ALLOW_SIM_GPS: "true",
      SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
      TAG_TOKEN_SECRET: "e2e-tag-token-secret-0123456789abcdef",
    },
  },
});
