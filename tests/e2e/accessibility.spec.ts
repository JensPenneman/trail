import { expect, type Page } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { overlandBatch } from "./support/overlandBatch";
import { sharingFriend } from "./support/sharingFriend";
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
    await expect(page.getByRole("button", { name: "Share my location" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sharing with you" })).toHaveCount(0);
    await expectAccessible(page, "People's list without devices or anyone who shares");
    // Me's detail without a device: the way to adding one.
    await open(page, "/?person=me", "People", "Connect your first phone");
    await expectAccessible(page, "Me's detail without devices");
    await open(page, "/settings/devices", "Devices", "No devices yet");
    await expectAccessible(page, "Settings › Devices without devices");

    await page.getByRole("button", { name: "Add device", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add a device" })).toBeVisible();
    await expectAccessible(page, "the add-device dialog");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    const device = await uploadedDevice(page, "Checked phone", overlandBatch(account.timezone));
    await open(page, "/", "People", "Me");
    await expectAccessible(page, "People's list");
    // Me's detail: the day so far and each device, the way to Settings › Devices.
    await open(page, "/?person=me", "People", "Timeline");
    await expect(page.getByRole("heading", { name: "Your devices" })).toBeVisible();
    await expectAccessible(page, "People's Live in Me's detail");
    await open(page, "/?view=history", "People", "Me");
    await expectAccessible(page, "People's History overview");
    await open(page, "/?view=history&person=me", "People", "Visits");
    await expectAccessible(page, "People's History in Me's detail");
    await open(page, "/?view=heat&person=me", "People", "Busiest places in view");
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

  test("People with someone who shares: the list and their detail", async ({
    page,
    account,
    openBrowser,
  }) => {
    test.slow();
    await uploadedDevice(page, "Checked phone", overlandBatch(account.timezone));
    const friend = await sharingFriend(openBrowser, account, "seen", {
      precision: "precise",
      historyDays: 7,
    });
    await open(page, "/", "People", friend.account.displayName);
    await expect(page.getByRole("button", { name: "Share my location" })).toBeVisible();
    await expectAccessible(page, "People's list with someone who shares");
    await open(page, `/?person=${friend.account.id}`, "People", "Where they’ve been");
    await expect(page.getByText(friend.device.name).first()).toBeVisible();
    await expectAccessible(page, "someone's detail in Live");
    await open(
      page,
      `/?view=history&person=${friend.account.id}`,
      "People",
      `${friend.account.displayName} · ${friend.device.name}`,
    );
    await expectAccessible(page, "someone's detail in History");
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
