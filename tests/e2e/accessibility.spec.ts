import { expect, type Page } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/** Opens a signed-in page by its URL and waits for its heading and data. */
async function open(page: Page, path: string, heading: string, ready?: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  if (ready !== undefined) await expect(page.getByText(ready).first()).toBeVisible();
}

test.describe("accessibility", () => {
  test("the sign-in page", { tag: "@signed-out" }, async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expectAccessible(page, "the sign-in page");
  });

  test("the page for an address that goes nowhere", { tag: "@signed-out" }, async ({ page }) => {
    await page.goto("/no/such/page");
    await expect(
      page.getByRole("heading", { level: 1, name: "This trail goes nowhere" }),
    ).toBeVisible();
    await expectAccessible(page, "the 404 page");
  });

  test("every signed-in page, with and without data", async ({ page, account }) => {
    // Every page and section one after the other, each scanned by axe: a long walk.
    test.slow();
    await expect(page.getByRole("heading", { name: "Connect your first phone" })).toBeVisible();
    await expect(page.getByText("Nobody shares with you yet")).toBeVisible();
    await expectAccessible(page, "People's Live without devices or anyone who shares");
    await open(page, "/settings/devices", "Devices", "No devices yet");
    await expectAccessible(page, "Settings › Devices without devices");

    await page.getByRole("button", { name: "Add device", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add a device" })).toBeVisible();
    await expectAccessible(page, "the add-device dialog");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    const device = await uploadedDevice(page, "Checked phone", overlandBatch(account.timezone));
    await open(page, "/", "People", "Timeline");
    await expectAccessible(page, "People's Live");
    // The Me card opened up: each device, the way to Settings › Devices.
    await page
      .getByRole("region", { name: "Me", exact: true })
      .getByRole("button", { name: "Details" })
      .click();
    await expect(page.getByRole("heading", { name: "Your devices" })).toBeVisible();
    await expectAccessible(page, "People's Live with Me's details");
    await open(page, "/?view=history", "People", "30 points");
    await expectAccessible(page, "People's History");
    await open(page, "/?view=heat", "People", "Busiest places in view");
    await expect(page.getByText(/^\d+ points$/).first()).toBeVisible();
    await expectAccessible(page, "People's Heat");
    // Settings › Devices, a device's page and the pages of its parts.
    await open(page, "/settings/devices", "Devices", "Checked phone");
    await expectAccessible(page, "Settings › Devices");
    await open(page, `/settings/devices/${device.id}`, "Checked phone", "Overview");
    await expectAccessible(page, "the device page");
    for (const [part, name, ready] of [
      ["uploads", "Uploads", "Overland"],
      ["points", "Raw points", "25 shown"],
      ["tracking", "Tracking settings", "Send with next upload"],
      ["setup", "Setup", "Recommended Overland settings"],
    ] as const) {
      await open(page, `/settings/devices/${device.id}/${part}`, name, ready);
      await expectAccessible(page, `the device's ${name.toLowerCase()}`);
    }
    // Settings, every page of it and the administrators' one: settings.spec.ts.
  });

  test("the setup code of a new device", async ({ page, account }) => {
    expect(account.email).toBeTruthy();
    await page.goto("/settings/devices?add=1");
    const form = page.getByRole("dialog", { name: "Add a device" });
    await form.getByLabel("Name").fill("Scanned phone");
    await form.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByRole("dialog", { name: "Set up Scanned phone" })).toBeVisible();
    await expectAccessible(page, "the setup code dialog");
  });
});
