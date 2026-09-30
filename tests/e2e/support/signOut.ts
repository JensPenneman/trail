import { expect, type Page } from "@playwright/test";

/**
 * Signs out from Settings (the one place for it on phones too) and waits for
 * the sign-in page. It waits for the live connection first, as a person looking
 * at the page would: signing out while the event stream is still connecting
 * has that request refused, which the browser logs.
 */
export async function signOut(page: Page): Promise<void> {
  await openSettingsConnected(page);
  await page
    .getByRole("region", { name: "About" })
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
}

/** Settings, with the page's event stream connected. */
export async function openSettingsConnected(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByText("Live updates on")).toBeAttached();
}
