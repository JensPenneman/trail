import { expect } from "@playwright/test";
import { openSettingsConnected, signOut } from "./support/signOut";
import { currentUser } from "./support/signUp";
import { test } from "./support/test";

test.describe("signing in again", () => {
  test.describe("in a browser without passkey autofill", () => {
    test.use({ passkeyAutofill: false });

    test("works with the email address, and with “Use a passkey”", async ({ page, account }) => {
      await signOut(page);
      await expect(page).toHaveURL(/\/login$/);
      await page.getByLabel("Email address").fill(account.email);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
      expect((await currentUser(page)).email).toBe(account.email);

      await signOut(page);
      await page.getByRole("button", { name: "Use a passkey" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
      expect((await currentUser(page)).id).toBe(account.id);
    });
  });

  test("offers the saved passkey in the email field's autofill", async ({ page, account }) => {
    // The virtual authenticator answers the autofill request at once, as if the person
    // picked their passkey from the list under the email field.
    await openSettingsConnected(page);
    const shownSignIn = page.waitForURL(/\/login$/);
    await page
      .getByRole("region", { name: "About" })
      .getByRole("button", { name: "Sign out" })
      .click();
    await shownSignIn;
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
    expect((await currentUser(page)).id).toBe(account.id);
  });
});
