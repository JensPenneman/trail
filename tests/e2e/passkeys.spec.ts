import { expect } from "@playwright/test";
import { test } from "./support/test";

test.describe("passkeys", () => {
  test("can be added with another authenticator, renamed and deleted — except the last", async ({
    page,
    authenticator,
    account,
    consoleGuard,
  }) => {
    expect(account.email).toContain("@");
    await page.goto("/settings");
    const passkeys = page.getByRole("region", { name: "Passkeys", exact: true });
    const rows = passkeys.getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("works on this address");

    // A security key; the built-in authenticator, which already holds a passkey, is not touched.
    const securityKey = await authenticator.addSecurityKey();
    await authenticator.setPresence(false);
    await passkeys.getByRole("button", { name: "Add a passkey here" }).click();
    await expect(rows).toHaveCount(2);
    expect(await securityKey.passkeys()).toHaveLength(1);
    await authenticator.setPresence(true);

    await rows
      .nth(1)
      .getByRole("button", { name: /^Rename / })
      .click();
    const rename = page.getByRole("dialog", { name: "Rename passkey" });
    await rename.getByLabel("Name").fill("Security key");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(rename).toBeHidden();
    await expect(rows.nth(1)).toContainText("Security key");

    await passkeys.getByRole("button", { name: "Delete Security key" }).click();
    const remove = page.getByRole("dialog", { name: "Delete “Security key”?" });
    await remove.getByRole("button", { name: "Delete passkey" }).click();
    await expect(remove).toBeHidden();
    await expect(rows).toHaveCount(1);

    // The server refuses to delete the only passkey left (409 last_passkey).
    consoleGuard.expectFailedResponse(409, /\/api\/me\/passkeys\/[^/]+$/);
    await rows
      .first()
      .getByRole("button", { name: /^Delete / })
      .click();
    const last = page.getByRole("dialog", { name: /^Delete “/ });
    await last.getByRole("button", { name: "Delete passkey" }).click();
    await expect(last.getByRole("alert")).toContainText("This is your only passkey");
    await expect(last.getByRole("button", { name: "Delete passkey" })).toBeDisabled();
    await last.getByRole("button", { name: "Cancel" }).click();
    await expect(rows).toHaveCount(1);
  });

  test("a one-time link adds a passkey on another device and signs it in", async ({
    page,
    account,
    openBrowser,
    consoleGuard,
  }) => {
    await page.goto("/settings");
    const section = page.getByRole("region", {
      name: "Add a passkey on another device or address",
      exact: true,
    });
    await section.getByRole("button", { name: "Create link" }).click();
    await expect(
      section.getByRole("img", { name: "Code with the one-time passkey link" }),
    ).toBeVisible();
    const link = await section.getByRole("textbox", { name: "One-time link" }).inputValue();
    expect(link).toMatch(/\/link\/[A-Za-z0-9_-]{43}$/);

    const phone = await openBrowser();
    await phone.page.goto(link);
    await expect(
      phone.page.getByRole("heading", { level: 1, name: "Add a passkey" }),
    ).toBeVisible();
    await expect(phone.page.getByText(`For the account ${account.email}.`)).toBeVisible();
    await phone.page.getByRole("button", { name: "Create passkey and sign in" }).click();
    await expect(phone.page.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
    expect(await phone.authenticator.passkeys()).toHaveLength(1);

    await page.reload();
    await expect(
      page.getByRole("region", { name: "Passkeys", exact: true }).getByRole("listitem"),
    ).toHaveCount(2);

    // The link worked once.
    consoleGuard.expectFailedResponse(404, /\/api\/auth\/link\/[A-Za-z0-9_-]+$/);
    const later = await openBrowser();
    await later.page.goto(link);
    await expect(later.page.getByRole("alert")).toContainText("This link can’t be used");
  });
});
