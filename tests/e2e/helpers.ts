import { expect, type Page } from "@playwright/test";

/** Guest onboarding through the real UI. */
export async function signUp(page: Page, name: string) {
  await page.goto("/start");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Same-origin JSON call from inside the page (cookie + Origin like the app). */
export async function api<T = unknown>(page: Page, path: string, body?: unknown, method?: string): Promise<T> {
  return page.evaluate(
    async ({ path, body, method }) => {
      const r = await fetch(`/api${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(data)}`);
      return data;
    },
    { path, body, method },
  ) as Promise<T>;
}

const C: [number, number] = [13.35, 52.514];
export const PLAY_AREA = [
  { id: "zmain", type: "main", name: "Park", color: "#3B82F6", opacity: 0.06, shape: { kind: "circle", center: C, radiusM: 500 }, enabled: true, visibleTo: ["seeker", "hider"], behavior: { kind: "static" } },
];

type Settings = Record<string, Record<string, unknown>> & { simulation: boolean };

/** Group + simulated lobby match with short timings. Returns the match id. */
export async function simMatch(page: Page, patch: (s: Settings) => void = () => {}) {
  const g = await api<{ id: string; joinCode: string | null }>(page, "/groups", { name: "E2E sim", icon: "🎯" });
  const m = await api<{ id: string }>(page, `/groups/${g.id}/matches`, { name: "Sim run", presetId: "classic", zones: PLAY_AREA, quickStart: true });
  const info = await api<{ settings: Settings; simulationAllowed: boolean }>(page, `/matches/${m.id}`);
  expect(info.simulationAllowed).toBe(true);
  const s = info.settings;
  s.simulation = true;
  s.timing.countdownSec = 5;
  s.timing.hidingSec = 0;
  s.timing.durationMin = 5;
  patch(s);
  await api(page, `/matches/${m.id}/settings`, { settings: s }, "PUT");
  const group = await api<{ joinCode: string }>(page, `/groups/${g.id}`);
  return { matchId: m.id, groupId: g.id, joinCode: group.joinCode };
}

/** Lobby: agree to the rules, then get ready. */
export async function consentAndReady(page: Page) {
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "I agree" }).click();
  await expect(page.getByText("You agreed to these rules")).toBeVisible();
  await page.getByRole("button", { name: "I'm ready" }).click();
  await expect(page.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
}
