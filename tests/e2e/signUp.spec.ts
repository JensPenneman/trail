import { expect } from "@playwright/test";
import { test } from "./support/test";
import { uniqueEmail } from "./support/uniqueEmail";

test.describe("signing up", () => {
  test("an address on the allow-list gets an account and an empty Live page", async ({
    page,
    account,
  }) => {
    expect(account.email).toMatch(/@e2e\.trail\.test$/);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Connect your first phone" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a device" })).toHaveAttribute(
      "href",
      "/devices?add=1",
    );
    await expect(page.getByRole("heading", { name: "Uploads" })).toHaveCount(0);
  });

  test("an address that is neither listed nor invited is turned away", {
    tag: "@signed-out",
  }, async ({ page, consoleGuard }) => {
    consoleGuard.expectFailedResponse(403, /\/api\/auth\/start$/);
    const email = uniqueEmail("stranger", "not-invited.trail.test");
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    const notice = page.getByRole("alert");
    await expect(notice).toContainText("New accounts need an invitation");
    await expect(notice).toContainText(`${email} has no account on this server`);
    await expect(page).toHaveURL(/\/login$/);
  });
});
