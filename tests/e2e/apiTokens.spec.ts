import { expect, type Locator } from "@playwright/test";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiTokenSecretPattern, tokenVerificationSchema } from "@trail/contracts/apiToken";
import { expectAccessible } from "./support/expectAccessible";
import { test } from "./support/test";

const authorization = (secret: string) => ({ Authorization: `Bearer ${secret}` });

/** The secret on the one-time screen, as someone copying it would read it. */
async function secretOn(dialog: Locator): Promise<string> {
  const secret = await dialog.getByRole("textbox", { name: "API token" }).inputValue();
  expect(secret).toMatch(apiTokenSecretPattern);
  return secret;
}

test.describe("API tokens", () => {
  test("are created in Settings, verified, rolled and revoked", async ({
    page,
    account,
    request,
  }) => {
    expect(account.id).toBeTruthy();
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "API tokens" });
    await expect(section.getByText("No active tokens.")).toBeVisible();

    await section.getByRole("button", { name: "Create token" }).click();
    const form = page.getByRole("dialog", { name: "Create an API token" });
    await expect(form.getByRole("radio", { name: "Read-only" })).toBeChecked();
    await expectAccessible(page, "the create-token dialog");
    await form.getByLabel("Name").fill("Calendar agent");
    await form.getByRole("radio", { name: "Agent" }).check();
    await expect(form.getByRole("checkbox", { name: "locations:write" })).toBeChecked();
    await form.getByRole("button", { name: "Create token" }).click();

    const shown = page.getByRole("dialog", { name: "Copy the token “Calendar agent”" });
    await expect(shown.getByText("Copy it now: it is shown only this once")).toBeVisible();
    await expectAccessible(page, "the one-time secret");
    const secret = await secretOn(shown);

    // The `request` fixture has no session: the token is the only credential.
    const verified = await request.get(apiPaths.v1.tokens.verify, {
      headers: authorization(secret),
    });
    expect(verified.status()).toBe(200);
    expect(tokenVerificationSchema.parse(await verified.json())).toMatchObject({
      name: "Calendar agent",
      deviceIds: null,
      status: "active",
      scopes: expect.arrayContaining(["locations:read", "locations:write"]),
    });
    const me = await request.get(apiPaths.v1.me, { headers: authorization(secret) });
    expect(await me.json()).toMatchObject({ user: { id: account.id } });

    await shown.getByRole("button", { name: "I have saved it" }).click();
    await expect(shown).toBeHidden();
    const item = section.getByRole("listitem").filter({ hasText: "Calendar agent" });
    await expect(item.getByText(`trlk_…${secret.slice(-4)}`)).toBeVisible();
    await expect(item.getByText("Active", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(secret);

    await item.getByRole("button", { name: "Roll Calendar agent" }).click();
    const confirmRoll = page.getByRole("dialog", { name: "Roll “Calendar agent”?" });
    await confirmRoll.getByRole("button", { name: "Roll token" }).click();
    const rolled = page.getByRole("dialog", { name: "Copy the new secret of “Calendar agent”" });
    const newSecret = await secretOn(rolled);
    expect(newSecret).not.toBe(secret);
    const old = await request.get(apiPaths.v1.tokens.verify, { headers: authorization(secret) });
    expect(old.status()).toBe(401);
    expect(old.headers()["www-authenticate"]).toBe('Bearer realm="trail", error="invalid_token"');
    const fresh = await request.get(apiPaths.v1.tokens.verify, {
      headers: authorization(newSecret),
    });
    expect(fresh.status()).toBe(200);
    await rolled.getByRole("button", { name: "I have saved it" }).click();
    await expect(item.getByText(`trlk_…${newSecret.slice(-4)}`)).toBeVisible();

    await item.getByRole("button", { name: "Revoke Calendar agent" }).click();
    await page
      .getByRole("dialog", { name: "Revoke “Calendar agent”?" })
      .getByRole("button", { name: "Revoke token" })
      .click();
    await expect(item.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Expired and revoked" })).toBeVisible();
    await expect(item.getByRole("button", { name: "Roll Calendar agent" })).toHaveCount(0);
    const revoked = await request.get(apiPaths.v1.tokens.verify, {
      headers: authorization(newSecret),
    });
    expect(revoked.status()).toBe(401);
    expect((await revoked.json()).error.code).toBe("unauthorized");
    await expectAccessible(page, "Settings with a revoked token");
  });

  test("limit a token to some devices and an expiry date", async ({ page, account }) => {
    expect(account.id).toBeTruthy();
    await page.goto("/devices?add=1");
    const add = page.getByRole("dialog", { name: "Add a device" });
    await add.getByLabel("Name").fill("Tracked phone");
    await add.getByRole("button", { name: "Add device" }).click();
    await page
      .getByRole("dialog", { name: "Set up Tracked phone" })
      .getByRole("button", { name: "Done" })
      .click();

    await page.goto("/settings");
    const section = page.getByRole("region", { name: "API tokens" });
    await section.getByRole("button", { name: "Create token" }).click();
    const form = page.getByRole("dialog", { name: "Create an API token" });
    await form.getByLabel("Name").fill("Home Assistant");
    await form.getByRole("radio", { name: "Only some devices" }).check();
    await form.getByRole("checkbox", { name: "Tracked phone" }).check();
    await form.getByLabel("Expires").selectOption("never");
    await expect(form.getByText("A token without an expiry")).toBeVisible();
    await form.getByLabel("Expires").selectOption("date");
    await form.getByLabel("Last day it works").fill("2099-12-31");
    await form.getByRole("button", { name: "Create token" }).click();
    const shown = page.getByRole("dialog", { name: "Copy the token “Home Assistant”" });
    await shown.getByRole("button", { name: "I have saved it" }).click();

    const item = section.getByRole("listitem").filter({ hasText: "Home Assistant" });
    await expect(item.getByText(/Tracked phone from any address/)).toBeVisible();
    await expect(item.getByText(/Expires 31.*2099.*23:59/)).toBeVisible();
  });
});
