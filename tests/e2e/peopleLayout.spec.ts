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

test("History's popover keeps the period form and gives focus back to the date button", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Period phone", overlandBatch(account.timezone));
  await page.goto("/?view=history&person=me");
  await openPeriodPicker(page);
  await page.getByRole("radio", { name: "Period" }).click();
  // The same popover, now with the form for the period.
  await expect(page.getByRole("button", { name: "Show", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Period" })).toBeFocused();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByRole("group", { name: "Show one day or a period" })).toBeHidden();
  await expect(page.getByRole("button", { name: /, choose another day$/ })).toBeFocused();
});

test("on a phone the sheet scrolls over a map that stays, with its detents", async ({
  page,
  account,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "the sheet is for phones");
  await uploadedDevice(page, "Sheet phone", overlandBatch(account.timezone));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  const panel = page.locator(".map-page__panel");
  const before = await box(canvas(page));
  const peekTop = (await box(panel)).y;
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // At peek: a press above the sheet reaches the map, and its attribution is not covered.
  const reachesMap = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest(".maplibregl-map") !== null,
    [before.x + before.width / 2, peekTop - 40],
  );
  expect(reachesMap).toBe(true);
  const attribution = await box(page.locator(".maplibregl-ctrl-attrib").first());
  expect(attribution.y + attribution.height).toBeLessThanOrEqual(peekTop + 1);

  // Lifting the sheet leaves the map where it is.
  await page.evaluate(() => window.scrollTo({ top: 400 }));
  await page.waitForFunction(() => window.scrollY > 0);
  expect(await box(canvas(page))).toEqual(before);
  expect((await box(panel)).y).toBeLessThan(peekTop);
  await expectAccessible(page, "the people sheet lifted");

  // Focus on what the sheet covers lowers it to peek.
  await page.getByRole("button", { name: "Zoom in" }).focus();
  await page.waitForFunction(() => window.scrollY === 0);
  // And the button is uncovered afterwards.
  const zoomBox = await box(page.getByRole("button", { name: "Zoom in" }));
  const uncovered = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest(".maplibregl-ctrl-zoom-in"),
    [zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2],
  );
  expect(uncovered).not.toBeNull();

  // Selecting a person lifts it to the half detent.
  await page.getByRole("list", { name: "Me", exact: true }).getByRole("link").first().click();
  const half = await page.evaluate(() => {
    const marker = document.querySelector("[data-detent=half]")?.getBoundingClientRect().top ?? 0;
    const padding = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    return marker + window.scrollY - padding;
  });
  // The peek is capped below half the view, so there is a half detent to lift the sheet to.
  expect(half).toBeGreaterThan(0);
  await page.waitForFunction((target) => Math.abs(window.scrollY - target) < 3, half);
});

test("the controls and the zoom buttons clear each other on a 375 px screen", async ({
  page,
  account,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "the phone layout");
  await page.setViewportSize({ width: 375, height: 667 });
  await uploadedDevice(page, "Narrow phone", overlandBatch(account.timezone));
  await page.goto("/?view=history&person=me");
  await expect(mapView(page, "History")).toBeChecked();
  const overlay = await box(page.locator(".map-overlay"));
  const controlsEnd = overlay.y + overlay.height;
  const zoom = await box(page.getByRole("button", { name: "Zoom in" }));
  expect(zoom.y).toBeGreaterThanOrEqual(controlsEnd - 1);
  // The popover stays above the sheet.
  await openPeriodPicker(page);
  const popover = await box(page.locator(".period-control__popover"));
  const sheetTop = (await box(page.locator(".map-page__panel"))).y;
  expect(popover.y + popover.height).toBeLessThanOrEqual(sheetTop + 1);
  await expectAccessible(page, "the period popover on a narrow phone");
});

test("a press on the map with the sheet at half leaves the sheet where it is", async ({
  page,
  account,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "the sheet is for phones");
  await uploadedDevice(page, "Half phone", overlandBatch(account.timezone));
  await page.goto("/");
  await page.getByRole("list", { name: "Me", exact: true }).getByRole("link").first().click();
  await page.waitForFunction(() => window.scrollY > 100);
  // Settled: the scroll position stops changing.
  let at = -1;
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => window.scrollY);
      const settled = now === at;
      at = now;
      return settled;
    })
    .toBe(true);
  const map = await box(canvas(page));
  await page.mouse.click(map.x + map.width / 2, map.y + map.height / 3);
  // It stays put over a few dozen frames (a lowering would have started at once).
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const next = () => (++frames >= 30 ? done() : requestAnimationFrame(next));
        requestAnimationFrame(next);
      }),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(at);
});

test("the sheet's whole content can be scrolled to, clear of the header and the tab bar", async ({
  page,
  account,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "the sheet is for phones");
  await uploadedDevice(page, "Reach phone", overlandBatch(account.timezone));
  // Me's page is longer than the screen: its last row ends the sheet, and is what a person
  // scrolls to.
  await page.goto("/?person=me");
  const panel = page.locator(".map-page__panel");
  const rows = panel.locator("a[href], button");
  await expect(page.getByRole("heading", { level: 2, name: "Me", exact: true })).toBeVisible();
  const share = rows.last();
  const settled = async () => {
    let last = -1;
    await expect
      .poll(async () => {
        const now = await page.evaluate(() => window.scrollY);
        const same = now === last;
        last = now;
        return same;
      })
      .toBe(true);
  };
  const reachable = (locator: ReturnType<Page["locator"]>) =>
    locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit !== null && element.contains(hit);
    });
  const viewHeight = (await page.viewportSize())?.height ?? 0;
  expect(await panel.evaluate((e) => e.scrollHeight)).toBeGreaterThan(viewHeight * 0.6);

  // Brought into view the way a person scrolls to it: a snap point must not pull the end of a
  // long sheet back, under the tab bar.
  await share.scrollIntoViewIfNeeded();
  await settled();
  expect(await reachable(share)).toBe(true);

  // The first control, with the sheet lifted towards the header: not under it.
  const first = rows.first();
  await page.evaluate(() => window.scrollTo(0, 400));
  await settled();
  expect(await reachable(first)).toBe(true);
});

for (const [width, height] of [
  [320, 568],
  [390, 664],
] as const) {
  test(`the bar stops before the zoom buttons on a ${width} x ${height} screen, in History`, async ({
    page,
    account,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "the phone layout");
    await page.setViewportSize({ width, height });
    await uploadedDevice(page, "Small phone", overlandBatch(account.timezone));
    await page.goto("/?view=history&person=me");
    await expect(mapView(page, "History")).toBeChecked();
    const overlay = await box(page.locator(".map-overlay"));
    const zoom = await box(page.getByRole("button", { name: "Zoom in" }));
    const sheetTop = (await box(page.locator(".map-page__panel"))).y;
    // The zoom column is beside the bar, never under it, and the bar ends above the sheet.
    expect(zoom.x).toBeGreaterThanOrEqual(overlay.x + overlay.width - 1);
    expect(overlay.y + overlay.height).toBeLessThan(sheetTop);
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest(".maplibregl-ctrl-zoom-in"),
      [zoom.x + zoom.width / 2, zoom.y + zoom.height / 2],
    );
    expect(hit).not.toBeNull();
    // Map options open: the popover is above the sheet, or scrolls within a few rows.
    await openMapOptions(page);
    const popover = await box(page.locator(".map-options__body"));
    expect(popover.height).toBeGreaterThanOrEqual(11 * 16 - 1);
    // Its lower edge is not behind the sheet: what is drawn there is the popover's, and above the tab bar.
    const tabBar = await box(page.locator(".primary-nav"));
    expect(popover.y + popover.height).toBeLessThanOrEqual(tabBar.y);
    const lowerEdge = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest(".map-options__body") !== null,
      [popover.x + popover.width / 2, popover.y + popover.height - 4],
    );
    expect(lowerEdge).toBe(true);
    await expectAccessible(page, `Map options on a ${width} px screen`);
  });
}
