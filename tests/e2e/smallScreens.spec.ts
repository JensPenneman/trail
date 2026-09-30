import { expect, type Page } from "@playwright/test";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/** How far the page is wider than the window (0 = no sideways scrolling). */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.use({ viewport: { width: 320, height: 640 } });

test("nothing scrolls sideways on a 320 px wide screen", async ({ page, account }) => {
  const device = await uploadedDevice(
    page,
    "A phone with a rather long name",
    overlandBatch(account.timezone),
  );
  // Each page with its data loaded: tables and lists are what could get too wide.
  for (const [path, heading, loaded] of [
    ["/", "Live", "Last upload"],
    ["/history", "History", "30 points"],
    ["/explore", "Explore", /^\d+ points$/],
    ["/devices", "Devices", "30 points"],
    [`/devices/${device.id}`, "A phone with a rather long name", "25 shown"],
    ["/settings", "Settings", "works on this address"],
    ["/no/such/page", "This trail goes nowhere", "Go to Live"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(loaded).first()).toBeVisible();
    expect(await overflow(page), path).toBe(0);
  }
  await page.goto("/devices?add=1");
  await page.getByRole("dialog").getByLabel("Name").fill("Narrow phone");
  await page.getByRole("dialog").getByRole("button", { name: "Add device" }).click();
  await expect(page.getByRole("dialog", { name: "Set up Narrow phone" })).toBeVisible();
  expect(await overflow(page), "the setup dialog").toBe(0);
});

test("the sign-in page fits a 320 px wide screen", { tag: "@signed-out" }, async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect(await overflow(page)).toBe(0);
});
