import { expect, type Page } from "@playwright/test";
import { adminStatePath } from "./support/adminState";
import { expectAccessible } from "./support/expectAccessible";
import { overlandBatch } from "./support/overlandBatch";
import { currentUser } from "./support/signUp";
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
    await expect(page.getByRole("heading", { name: "Connect your first phone" })).toBeVisible();
    await expectAccessible(page, "Live without devices");
    await open(page, "/devices", "Devices", "No devices yet");
    await expectAccessible(page, "Devices without devices");

    await page.getByRole("button", { name: "Add device", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add a device" })).toBeVisible();
    await expectAccessible(page, "the add-device dialog");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    const device = await uploadedDevice(page, "Checked phone", overlandBatch(account.timezone));
    await open(page, "/", "Live", "Last upload");
    await expectAccessible(page, "Live");
    await open(page, "/history", "History", "30 points");
    await expectAccessible(page, "History");
    await open(page, "/explore", "Explore", "Busiest places in view");
    await expect(page.getByText(/^\d+ points$/).first()).toBeVisible();
    await expectAccessible(page, "Explore");
    await open(page, "/devices", "Devices", "Checked phone");
    await expectAccessible(page, "Devices");
    await open(page, `/devices/${device.id}`, "Checked phone", "Uploads of this device");
    await expectAccessible(page, "the device page");
    await open(page, "/settings", "Settings", "works on this address");
    await expectAccessible(page, "Settings");
  });

  test("the setup code of a new device", async ({ page, account }) => {
    expect(account.email).toBeTruthy();
    await page.goto("/devices?add=1");
    const form = page.getByRole("dialog", { name: "Add a device" });
    await form.getByLabel("Name").fill("Scanned phone");
    await form.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByRole("dialog", { name: "Set up Scanned phone" })).toBeVisible();
    await expectAccessible(page, "the setup code dialog");
  });

  test("Settings of an administrator, with people and invitations", async ({ openBrowser }) => {
    const admin = await openBrowser({ storageState: adminStatePath });
    test.skip(
      !(await currentUser(admin.page)).isAdmin,
      "The server's first account belongs to someone else",
    );
    await open(admin.page, "/settings", "Settings", "Invite someone");
    await expect(admin.page.getByRole("heading", { name: "Accounts" })).toBeVisible();
    await expectAccessible(admin.page, "Settings of an administrator");
  });
});
