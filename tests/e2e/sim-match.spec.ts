import { devices, expect, test } from "@playwright/test";
import { api, consentAndReady, signUp, simMatch } from "./helpers";

test("sim match with bots: ready → start → reveal → live map → end → results", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signUp(page, "Host");
  const { matchId } = await simMatch(page);
  await page.goto(`/matches/${matchId}`);
  await expect(page.getByText("Test match · simulated GPS · bots allowed", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Add bot" }).click();
  await expect(page.getByText("Players (2)")).toBeVisible();
  await page.getByRole("button", { name: "Add bot" }).click();
  await expect(page.getByText("Players (3)")).toBeVisible();
  await consentAndReady(page);
  await page.getByRole("button", { name: "Start match" }).click();

  // Target-lock reveal, then my role card.
  await expect(page.getByRole("dialog", { name: "Target lock" })).toBeVisible();
  await expect(page.getByText("You are", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Got it" }).click();

  // Live map with zones and the HUD timer.
  await expect(page.getByRole("region", { name: "Live match map" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByText("Park")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Players" })).toBeVisible();

  // Host ends the match from the host sheet.
  await page.getByRole("button", { name: "Match menu" }).click();
  await page.getByRole("menuitem", { name: "Host controls" }).click();
  await page.getByRole("button", { name: "End match" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "End match" }).click();
  await expect(page.getByText("The match was ended early.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("two players: seeker types the hider's 6-digit code → caught → results", async ({ browser }) => {
  const opts = { ...devices["Pixel 7"], baseURL: "http://localhost:3100" };
  const a = await (await browser.newContext(opts)).newPage();
  const b = await (await browser.newContext(opts)).newPage();
  await signUp(a, "Seeker Sam");
  await signUp(b, "Hider Hana");
  const { matchId, joinCode } = await simMatch(a, (s) => {
    s.roles.assignment = "manual";
    s.capture.methods = ["mutual", "qr", "code"];
    s.capture.outcome = "convert";
  });
  await api(b, "/groups/join", { codeOrToken: joinCode });

  await b.goto(`/matches/${matchId}`);
  await consentAndReady(b);
  await a.goto(`/matches/${matchId}`);
  await a.getByRole("radiogroup", { name: "Role for Hider Hana" }).getByRole("radio", { name: "Hider" }).click();
  await a.getByRole("radiogroup", { name: "Role for Seeker Sam" }).getByRole("radio", { name: "Seeker" }).click();
  await consentAndReady(a);
  await a.getByRole("button", { name: "Start match" }).click();

  // Hider shows the rotating code; the seeker types it.
  await b.getByRole("button", { name: "Show my tag code" }).click({ timeout: 30_000 });
  const codeText = await b.getByText(/^\d{3} \d{3}$/).textContent({ timeout: 15_000 });
  const code = (codeText ?? "").replace(/\s/g, "");
  expect(code).toMatch(/^\d{6}$/);

  const tagBtn = a.getByRole("button", { name: "Tag a hider" });
  await expect(tagBtn).toBeEnabled({ timeout: 30_000 });
  await tagBtn.click();
  await a.getByLabel("6-digit code").fill(code);
  await a.getByRole("button", { name: "Send", exact: true }).click();

  await expect(a.getByText("Seekers win")).toBeVisible();
  await expect(b.getByText("Seekers win")).toBeVisible();
});
