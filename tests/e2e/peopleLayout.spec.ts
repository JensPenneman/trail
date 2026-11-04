import { expect, type Page } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { mapView, openMapOptions, openPeriodPicker } from "./support/mapControls";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/*
 * The People page's layout (docs/architecture.md §14): the controls float
 * over the map on every screen; beside it the panel scrolls alone (desktop),
 * under it the people sit in a sheet that scrolls over the fixed map (phones).
 */

const bar = (page: Page) => page.getByRole("group", { name: "Map view" });
const canvas = (page: Page) => page.locator(".map-page__canvas");
const box = async (locator: ReturnType<Page["locator"]>) => {
  const rect = await locator.boundingBox();
  if (rect === null) throw new Error("not on the page");
  return rect;
};

test("the view switch and the map options float over the map's top-left corner", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Layout phone", overlandBatch(account.timezone));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  const map = await box(canvas(page));
  const switcher = await box(bar(page));
  const options = await box(page.getByRole("button", { name: "Map options" }));
  for (const control of [switcher, options]) {
    expect(control.x).toBeGreaterThanOrEqual(map.x);
    expect(control.y).toBeGreaterThanOrEqual(map.y);
    expect(control.x + control.width).toBeLessThanOrEqual(map.x + map.width);
    expect(control.y + control.height).toBeLessThanOrEqual(map.y + map.height);
  }
  // The zoom buttons keep the top-right corner and do not sit under the bar.
  const zoom = await box(page.getByRole("button", { name: "Zoom in" }));
  expect(zoom.x + zoom.width).toBeGreaterThan(map.x + map.width - 80);
  const barBottom = Math.max(switcher.y + switcher.height, options.y + options.height);
  const overlaps =
    zoom.x < switcher.x + switcher.width && zoom.x + zoom.width > switcher.x && zoom.y < barBottom;
  expect(overlaps).toBe(false);
  await expectAccessible(page, "the map with its controls over it");
});

test("the map options open as a popover that Escape and a press outside close", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Options phone", overlandBatch(account.timezone));
  await page.goto("/?person=me");
  const toggle = page.getByRole("button", { name: "Map options" });
  await openMapOptions(page);
  await expect(page.getByRole("group", { name: "Detail of the tracks" })).toBeVisible();
  await expectAccessible(page, "the map options open");

  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await expect(page.getByRole("group", { name: "Map style" })).toBeHidden();

  await openMapOptions(page);
  await page.getByRole("heading", { level: 1, name: "People" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("History's date button opens a popover with Day | Period and the calendar", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Calendar phone", overlandBatch(account.timezone));
  await page.goto("/?view=history&person=me");
  await expect(mapView(page, "History")).toBeChecked();
  await expect(page.getByRole("button", { name: "Previous day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next day" })).toBeVisible();
  const date = page.getByRole("button", { name: /, choose another day$/ });
  await openPeriodPicker(page);
  await expect(page.getByRole("radio", { name: "Day" })).toBeChecked();
  await expect(page.getByRole("grid")).toBeVisible();
  await expectAccessible(page, "the calendar popover open");
  await page.keyboard.press("Escape");
  await expect(date).toBeFocused();
  await expect(page.getByRole("group", { name: "Show one day or a period" })).toBeHidden();
});

test("on a wide screen only the docked panel scrolls", async ({ page, account }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the docked panel is for wide screens");
  await uploadedDevice(page, "Docked phone", overlandBatch(account.timezone));
  await page.goto("/?person=me");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  const panel = page.getByRole("region", { name: "People", exact: true }).first();
  const map = await box(canvas(page));
  const docked = await box(panel);
  expect(docked.x + docked.width).toBeLessThanOrEqual(map.x + 1);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeLessThanOrEqual(0);
});

test("on a phone the sheet scrolls over a map that stays", async ({ page, account }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "the sheet is for phones");
  await uploadedDevice(page, "Sheet phone", overlandBatch(account.timezone));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  const before = await box(canvas(page));
  const heading = page.getByRole("heading", { level: 1, name: "People" });
  const peek = (await box(heading)).y;
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.evaluate(() => window.scrollTo({ top: 400 }));
  await page.waitForFunction(() => window.scrollY > 0);
  // The map did not move; the sheet rose over it.
  expect(await box(canvas(page))).toEqual(before);
  expect((await box(heading)).y).toBeLessThan(peek);
  // The sheet leaves the map's last pixels to the attribution until it has been lifted.
  expect(before.y + before.height).toBeLessThan((await page.viewportSize())?.height ?? 0);
  await expectAccessible(page, "the people sheet lifted");
});
