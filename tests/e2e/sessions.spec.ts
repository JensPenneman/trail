import { expect } from "@playwright/test";
import { test } from "./support/test";

test.describe("signed-in browsers", () => {
  test.use({ passkeyAutofill: false });

  test("are listed, and signing out the others ends their sessions at once", async ({
    page,
    account,
    authenticator,
    openBrowser,
  }) => {
    // The same person on a second browser: the passkey syncs there.
    const [passkey] = await authenticator.passkeys();
    if (passkey === undefined) throw new Error("The account has no passkey");
    const other = await openBrowser();
    await other.authenticator.importPasskey(passkey);
    await other.page.goto("/login");
    await other.page.getByRole("button", { name: "Use a passkey" }).click();
    await expect(other.page.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
    await expect(other.page.getByText("Live updates on")).toBeAttached();

    await page.goto("/settings");
    const browsers = page.getByRole("region", { name: "Signed-in browsers", exact: true });
    await expect(browsers.getByRole("listitem")).toHaveCount(2);
    await expect(browsers.getByText("This browser")).toHaveCount(1);
    await browsers.getByRole("button", { name: "Sign out everywhere else" }).click();
    await expect(browsers.getByRole("listitem")).toHaveCount(1);

    // The other browser hears about it over its event stream and shows the sign-in page.
    await expect(other.page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(other.page).toHaveURL(/\/login$/);
    expect((await other.page.request.get("/api/auth/session")).status()).toBe(401);
    expect((await page.request.get("/api/auth/session")).status()).toBe(200);
    expect(account.id).toBeTruthy();
  });
});
