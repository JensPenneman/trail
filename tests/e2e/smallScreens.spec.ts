import { expect, type Page } from "@playwright/test";
import { overlandBatch } from "./support/overlandBatch";
import { sharingFriend } from "./support/sharingFriend";
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
    ["/", "People", "Last upload"],
    ["/?view=history", "People", "30 points"],
    ["/?view=heat", "People", /^\d+ points$/],
    ["/devices", "Devices", "30 points"],
    [`/devices/${device.id}`, "A phone with a rather long name", "25 shown"],
    ["/settings/profile", "Settings", "Time zone"],
    ["/settings/passkeys", "Settings", "works on this address"],
    ["/settings/tokens", "Settings", "No active tokens."],
    ["/settings/sharing", "Settings", "Nobody sees your location."],
    ["/settings/data", "Settings", "Delete a period"],
    ["/settings/about", "Settings", "Receiver endpoint"],
    ["/no/such/page", "This trail goes nowhere", "Go to the map"],
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

test("the People page with someone who shares fits a 320 px wide screen", async ({
  page,
  account,
  openBrowser,
}) => {
  await uploadedDevice(page, "A phone with a rather long name", overlandBatch(account.timezone));
  const friend = await sharingFriend(openBrowser, account, "someone-with-a-long-name", {
    precision: "precise",
    historyDays: 7,
  });
  const name = friend.account.displayName;
  for (const [path, loaded] of [
    ["/", "Last 7 days"],
    [`/?people=${friend.account.id}`, "On the map"],
    [`/?view=history&people=me,${friend.account.id}`, `${name} · ${friend.device.name}`],
    [`/?view=history&people=${friend.account.id}`, `${name} · ${friend.device.name}`],
    [`/?view=heat&people=me,${friend.account.id}`, "Your own devices only"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await expect(page.getByRole("article", { name })).toBeVisible();
    await expect(page.getByText(loaded).first()).toBeVisible();
    expect(await overflow(page), path).toBe(0);
  }
});

test("the sign-in page fits a 320 px wide screen", { tag: "@signed-out" }, async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect(await overflow(page)).toBe(0);
});
