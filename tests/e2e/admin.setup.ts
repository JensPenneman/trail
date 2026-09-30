import { expect } from "@playwright/test";
import { adminStatePath } from "./support/adminState";
import { test } from "./support/test";

/*
 * Runs before every other project: on a fresh server the first account is the
 * administrator, whom the invitation tests need. Its session is saved for them.
 */
test("the first account on a fresh server is its administrator", async ({ page, account }) => {
  // Against a deployment with existing accounts (E2E_BASE_URL) someone else is the admin.
  if (process.env["E2E_BASE_URL"] === undefined) expect(account.isAdmin).toBe(true);
  await page.goto("/settings");
  if (account.isAdmin) await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await page.context().storageState({ path: adminStatePath });
});
