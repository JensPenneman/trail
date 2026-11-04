import { expect, type Page } from "@playwright/test";
import { overlandBatch } from "./support/overlandBatch";
import { sharingFriend } from "./support/sharingFriend";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/** How far the page is wider than the window (0 = no sideways scrolling). */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * The page does not scroll sideways once it has laid out. A page that is still filling in (a
 * table arriving, fonts swapping) is wider for a moment under load; one that stays wider fails.
 */
const fits = (page: Page, what: string) =>
  expect.poll(() => overflow(page), { message: what }).toBe(0);

test.use({ viewport: { width: 320, height: 640 } });

test("nothing scrolls sideways on a 320 px wide screen", async ({ page, account }) => {
  // Every page, Settings' fifteen and a device's four included, each loaded by its address: a
  // long walk.
  test.slow();
  const device = await uploadedDevice(
    page,
    "A phone with a rather long name",
    overlandBatch(account.timezone),
  );
  // Each page with its data loaded: tables and lists are what could get too wide.
  for (const [path, heading, loaded] of [
    ["/", "People", "Me"],
    ["/?person=me", "People", "Timeline"],
    ["/?view=history", "People", "30 points"],
    ["/?view=heat", "People", /^\d+ points$/],
    ["/settings", "Settings", "Privacy & data"],
    ["/settings/profile", "Profile", "Time zone"],
    ["/settings/devices", "Devices", "30 points in total"],
    [`/settings/devices/${device.id}`, "A phone with a rather long name", "Overview"],
    [`/settings/devices/${device.id}/uploads`, "Uploads", "Overland"],
    [`/settings/devices/${device.id}/points`, "Raw points", "25 shown"],
    [`/settings/devices/${device.id}/tracking`, "Tracking settings", "Send with next upload"],
    [`/settings/devices/${device.id}/setup`, "Setup", "Recommended Overland settings"],
    ["/settings/passkeys", "Passkeys", "works on this address"],
    ["/settings/browsers", "Browsers", "This browser"],
    ["/settings/sharing", "Sharing", "Nobody sees your location."],
    ["/settings/links", "Public links", "No links yet."],
    ["/settings/privacy/viewers", "Who viewed you", "Nobody looked in the last 30 days"],
    ["/settings/privacy/access-log", "Access log", "Nothing recorded yet"],
    ["/settings/data", "Your data", "Delete a period"],
    ["/settings/tokens", "API tokens", "No active tokens."],
    ["/settings/mcp", "MCP", "Server address"],
    ["/settings/preferences", "Preferences", "Detail of the tracks"],
    ["/settings/notifications", "Notifications", "A phone with a rather long name"],
    ["/settings/about", "About", "OwnTracks endpoint"],
    ["/no/such/page", "This trail goes nowhere", "Go to the map"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(loaded).first()).toBeVisible();
    await fits(page, path);
  }
  await page.goto("/settings/devices?add=1");
  await page.getByRole("dialog").getByLabel("Name").fill("Narrow phone");
  await page.getByRole("dialog").getByRole("button", { name: "Add device" }).click();
  await expect(page.getByRole("dialog", { name: "Set up Narrow phone" })).toBeVisible();
  await fits(page, "the setup dialog");

  // OwnTracks' setup: long URLs, a link per platform, two lists of settings.
  await page.goto("/settings/devices?add=1");
  const form = page.getByRole("dialog", { name: "Add a device" });
  await form.getByLabel("Name").fill("Narrow Pixel");
  await form.getByRole("radio", { name: /^OwnTracks/ }).check();
  await fits(page, "the add-device form with its apps");
  await form.getByRole("button", { name: "Add device" }).click();
  const setup = page.getByRole("dialog", { name: "Set up Narrow Pixel" });
  await expect(setup.getByRole("link", { name: "Open in OwnTracks" })).toBeVisible();
  await fits(page, "OwnTracks' setup");
  await setup.getByRole("radio", { name: "Significant changes" }).check();
  await fits(page, "OwnTracks' setup for an iPhone saving battery");
  await setup.getByRole("radio", { name: "Android" }).check();
  await expect(setup.getByText("Recommended OwnTracks settings on Android")).toBeVisible();
  await fits(page, "OwnTracks' setup for Android");
});

test("the People page with someone who shares fits a 320 px wide screen", async ({
  page,
  account,
  openBrowser,
}) => {
  // Two people with a phone each, six pages and the details opened: a long walk.
  test.slow();
  await uploadedDevice(page, "A phone with a rather long name", overlandBatch(account.timezone));
  const friend = await sharingFriend(openBrowser, account, "someone-with-a-long-name", {
    precision: "precise",
    historyDays: 7,
  });
  const name = friend.account.displayName;
  for (const [path, loaded, detail] of [
    ["/", name, null],
    ["/?person=me", "Timeline", "Me"],
    [`/?person=${friend.account.id}`, "Where they’ve been", name],
    [`/?view=history&person=${friend.account.id}`, `${name} · ${friend.device.name}`, name],
    ["/?view=history", `${name} · ${friend.device.name}`, null],
    ["/?view=heat&person=me", "Your devices", "Me"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    // The list, or the detail of the person the address names.
    await expect(
      detail === null
        ? page.getByRole("list", { name: "People", exact: true })
        : page.getByRole("region", { name: detail, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(loaded).first()).toBeVisible();
    await fits(page, path);
  }
  // Their detail and Me's, with each device and the terms of the share: they fit too.
  await page.goto(`/?view=history&person=${friend.account.id}`);
  await expect(page.getByText("Last 7 days")).toBeVisible();
  await fits(page, "their detail");
  await page.goto("/?view=history&person=me");
  await expect(page.getByRole("heading", { name: "Your devices" })).toBeVisible();
  await fits(page, "Me's detail");
});

test("the sign-in page fits a 320 px wide screen", { tag: "@signed-out" }, async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await fits(page, "the sign-in page");
});
