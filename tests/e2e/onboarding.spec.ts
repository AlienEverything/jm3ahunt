import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("onboarding → create group → quick-start match → lobby", async ({ page }) => {
  await signUp(page, "Ada");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/new/);
  await page.getByLabel("Group name").fill("E2E crew");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+$/);
  await page.getByRole("button", { name: /^Start a Classic match now/ }).click();
  await expect(page).toHaveURL(/\/matches\/[^/]+$/);
  await expect(page.getByText("Lobby", { exact: true })).toBeVisible();
  await expect(page.getByText("Players (1)")).toBeVisible();
  await expect(page.getByText("Ada", { exact: true }).first()).toBeVisible();
});
