import { expect, type Page } from "@playwright/test";
import { insightsOverviewSchema } from "@trail/contracts/insights";
import { timelineResponseSchema } from "@trail/contracts/transport";
import { expectAccessible } from "./support/expectAccessible";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";
import { walkAndDrive } from "./support/walkAndDrive";

/*
 * Insights on a walk and a drive the server worked out itself (without map
 * data, from speeds and motion readings): the overview and its periods, a
 * chart by keyboard, a mode's page and its link to the map, when you travel,
 * roads, axe on every page and a 320 px screen.
 */

/** How far the page is wider than the window (0 = no sideways scrolling). */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Waits until processing has made the two moves of the journey (the worker runs seconds later). */
async function processed(page: Page): Promise<void> {
  const now = Date.now();
  const range = {
    from: new Date(now - 2 * 86_400_000).toISOString(),
    to: new Date(now + 3_600_000).toISOString(),
  };
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/segments", { params: range });
        const timeline = timelineResponseSchema.parse(await response.json());
        const modes = timeline.items
          .filter((item) => item.kind === "move")
          .map((item) => item.mode);
        return timeline.pending ? [] : modes;
      },
      { timeout: 45_000, intervals: [1_000] },
    )
    .toEqual(["walking", "car"]);
}

test("Insights: the overview, a mode, when you travel and roads", async ({ page, account }) => {
  test.slow();
  await uploadedDevice(page, "Walker", walkAndDrive());
  expect(account.timezone).toBe("Europe/Brussels");
  await processed(page);

  // The tab in the main navigation.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Insights" })
    .click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeFocused();
  const tiles = page.getByRole("group", { name: "Totals" });
  await expect(tiles.getByText("Moves")).toBeVisible();
  const breakdown = page.getByRole("figure", { name: "Distance by mode" });
  await expect(breakdown.getByRole("img", { name: "Car" })).toBeAttached();
  await expect(breakdown.getByRole("img", { name: "Walking" })).toBeAttached();
  await expect(breakdown).toHaveAccessibleDescription(/^Car: most of the distance, 9\d%/);
  const overview = insightsOverviewSchema.parse(
    await (await page.request.get("/api/v1/insights/overview")).json(),
  );
  expect(overview.totals.moves).toBe(2);
  expect(overview.modes.map((row) => row.mode)).toEqual(["car", "walking"]);
  await expectAccessible(page, "the Insights overview");

  // Another period: the address keeps it, the numbers follow.
  const weekly = page.waitForResponse((response) =>
    response.url().includes("/api/v1/insights/overview"),
  );
  await page.getByRole("radio", { name: "7 days" }).check();
  await expect(page).toHaveURL(/\/insights\?period=7d$/);
  expect((await weekly).ok()).toBe(true);
  await expect(page.getByText("How you travelled in the last 7 days.")).toBeVisible();
  await expect(breakdown.getByRole("img", { name: "Car" })).toBeAttached();

  // A chart by keyboard: one tab stop, the arrow keys move along its marks.
  await page.getByRole("radio", { name: "7 days" }).focus();
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    if (
      await breakdown
        .getByRole("img", { name: "Car" })
        .evaluate((mark) => mark === document.activeElement)
    ) {
      break;
    }
  }
  const car = breakdown.getByRole("img", { name: "Car" });
  await expect(car).toBeFocused();
  await expect(car).toHaveAccessibleDescription(/km · 9\d%/);
  await expect(breakdown.locator(".chart-tooltip")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const walking = breakdown.getByRole("img", { name: "Walking" });
  await expect(walking).toBeFocused();
  await expect(breakdown.locator(".chart-tooltip")).toContainText("km");
  await page.keyboard.press("Escape");
  await expect(breakdown.locator(".chart-tooltip")).toBeHidden();
  await expect(walking).toBeFocused();

  // The table opens a mode's page, which keeps the period.
  await page
    .getByRole("table", { name: "Modes of the period" })
    .getByRole("link", { name: "Car" })
    .click();
  await expect(page).toHaveURL(/\/insights\/transport\/car\?period=7d$/);
  await expect(page.getByRole("heading", { level: 1, name: "Car" })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Moves by speed" })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Time by hour of the day" })).toBeVisible();
  await expect(page.getByText("No map data for these moves")).toBeVisible();
  await expectAccessible(page, "the mode page");

  // A top move opens its day on the map, with its details.
  await page
    .getByRole("link", { name: /^Show on the map/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/\?view=history&date=\d{4}-\d{2}-\d{2}&segment=[0-9a-f-]{36}$/);
  const dialog = page.getByRole("dialog", { name: "Car" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/segment=/);

  // When you travel: the hours of the week, for every mode or one.
  await page.goto("/insights/time?period=7d");
  const grid = page.getByRole("figure", { name: "Time on the move by weekday and hour" });
  await expect(grid).toBeVisible();
  await expect(grid).toHaveAccessibleDescription(/^Most often on \w+day at \d{2}:00/);
  await page.getByRole("combobox", { name: "Mode" }).selectOption({ label: "Walking" });
  await expect(page).toHaveURL(/mode=walking/);
  await expect(
    page.getByRole("figure", { name: "Time by walking by weekday and hour" }),
  ).toBeVisible();
  await expectAccessible(page, "When you travel");

  // Roads: this server has no map data, and says so.
  await page
    .getByRole("navigation", { name: "Insights" })
    .getByRole("link", { name: "Roads" })
    .click();
  await expect(page).toHaveURL(/\/insights\/roads\?period=7d&mode=walking$/);
  await expect(page.getByRole("heading", { level: 1, name: "Roads" })).toBeVisible();
  await expect(page.getByText("No map data for these moves")).toBeVisible();
  await expectAccessible(page, "Roads");
});

test.describe("on a 320 px wide screen", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("Insights fit and stay accessible", async ({ page, account }) => {
    test.slow();
    expect(account.timezone).toBe("Europe/Brussels");
    await uploadedDevice(page, "Narrow walker", walkAndDrive());
    await processed(page);
    for (const [path, heading, loaded] of [
      ["/insights", "Insights", "Distance by mode"],
      ["/insights/transport/walking", "Walking", "Moves by speed"],
      ["/insights/time", "When you travel", "Time on the move by weekday and hour"],
      ["/insights/roads", "Roads", "No map data for these moves"],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(loaded).first()).toBeVisible();
      expect(await overflow(page), path).toBe(0);
      await expectAccessible(page, `${path} at 320 px`);
    }
  });
});
