import { expect, type Page } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { overlandBatch } from "./support/overlandBatch";
import { sharingFriend } from "./support/sharingFriend";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/*
 * The People sidebar's root (docs/architecture.md §14): Me first, then those
 * who share with you, a Hidden level below it, and on phones a sheet whose peek
 * shows Me.
 */

const meList = (page: Page) => page.getByRole("list", { name: "Me", exact: true });
const sharingList = (page: Page) =>
  page.getByRole("list", { name: "Sharing with you", exact: true });

test("the root lists Me, then the people who share, and nothing else", async ({
  page,
  account,
  openBrowser,
}) => {
  test.slow();
  await uploadedDevice(page, "Root phone", overlandBatch(account.timezone));
  await sharingFriend(openBrowser, account, "first", { precision: "precise", historyDays: null });
  await sharingFriend(openBrowser, account, "second", {
    precision: "approximate",
    historyDays: null,
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(meList(page).getByRole("link", { name: /^Me(\s|$)/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Sharing with you" })).toBeVisible();
  await expect(sharingList(page).getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Share my location" })).toBeVisible();
  // No summary, no totals, no footer, no card.
  await expect(page.getByRole("region", { name: "Summary", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^You share with/ })).toHaveCount(0);
  await expect(page.getByText("Nobody shares with you yet")).toHaveCount(0);
  // Few people: no search.
  await expect(page.getByRole("searchbox", { name: "Search people" })).toHaveCount(0);
  await expectAccessible(page, "the root with two people who share");
});

test("the Hidden level opens from its row, takes the focus and gives it back", async ({
  page,
  account,
  openBrowser,
}) => {
  test.slow();
  await uploadedDevice(page, "Hider phone", overlandBatch(account.timezone));
  const friend = await sharingFriend(openBrowser, account, "hidden", {
    precision: "precise",
    historyDays: null,
  });
  const name = friend.account.displayName;
  await page.goto("/");
  await sharingList(page)
    .getByRole("link", {
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`),
    })
    .click();
  await page.getByRole("button", { name: `Hide ${name}` }).click();
  const row = page.getByRole("link", { name: "Hidden (1)" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/[?&]list=hidden$/);
  await expect(page.getByRole("heading", { level: 2, name: "Hidden" })).toBeFocused();
  await expect(page.getByRole("button", { name: `Show ${name} again` })).toBeVisible();
  await expectAccessible(page, "the Hidden level");
  // Back is a step of the history, and the focus returns to the row that opened the level.
  await page.goBack();
  await expect(page).not.toHaveURL(/list=hidden/);
  await expect(row).toBeFocused();
  await page.goForward();
  await page.getByRole("button", { name: `Show ${name} again` }).click();
  await expect(page.getByText("Nobody is hidden.")).toBeVisible();
});

test("on a phone the peek shows Me, above the tab bar", async ({ page, account }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "the sheet is for phones");
  await uploadedDevice(page, "Peek phone", overlandBatch(account.timezone));
  await page.goto("/");
  const me = meList(page).getByRole("link", { name: /^Me(\s|$)/ });
  await expect(me).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const row = await me.boundingBox();
  const tabBar = await page.locator(".primary-nav").boundingBox();
  if (row === null || tabBar === null) throw new Error("not on the page");
  expect(row.y + row.height).toBeLessThanOrEqual(tabBar.y);
  // The peek ends just under the row, not at a fixed height.
  const sheet = await page.locator(".map-page__panel").boundingBox();
  if (sheet === null) throw new Error("no sheet");
  expect(sheet.y).toBeLessThan(row.y);
  expect(tabBar.y - (row.y + row.height)).toBeLessThan(120);
});

test("in History the peek still ends under the Me row, with the slider right below it", async ({
  page,
  account,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "the sheet is for phones");
  await uploadedDevice(page, "History peek phone", overlandBatch(account.timezone));
  await page.goto("/?view=history");
  const me = meList(page).getByRole("link", { name: /^Me(\s|$)/ });
  await expect(me).toBeVisible();
  const slider = page.getByRole("slider", { name: "Position at" });
  await expect(slider).toBeAttached();
  const tabBar = await page.locator(".primary-nav").boundingBox();
  const row = await me.boundingBox();
  const sliderBox = await slider.boundingBox();
  if (tabBar === null || row === null || sliderBox === null) throw new Error("not on the page");
  // Me is in the peek; the slider is under it, below the fold until the sheet is lifted.
  expect(row.y + row.height).toBeLessThanOrEqual(tabBar.y);
  expect(sliderBox.y).toBeGreaterThan(row.y + row.height - 1);
  // The half detent is below the peek, so lifting the sheet shows the slider.
  const lifted = await page.evaluate(() => {
    document.querySelector("[data-detent=half]")?.scrollIntoView({ block: "start" });
    return window.scrollY;
  });
  expect(lifted).toBeGreaterThan(0);
});
