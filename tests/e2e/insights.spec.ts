import { expect, type Page } from "@playwright/test";
import { insightsOverviewSchema } from "@trail/contracts/insights";
import { timelineResponseSchema } from "@trail/contracts/transport";
import { addDevice } from "./support/addDevice";
import { expectAccessible } from "./support/expectAccessible";
import { stayAndWalk } from "./support/stayAndWalk";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";
import { walkAndDrive } from "./support/walkAndDrive";

/*
 * Insights on a walk and a drive the server worked out itself (without map
 * data, from speeds and motion readings), on a wide screen (the list beside
 * the screen) and on a phone (the list part of the summary, one screen at a
 * time): the summary and its period by week, month and year, a chart by
 * keyboard, a mode's screen and the way back to its row, when you travel,
 * roads, axe on every screen and on the popovers, and a 320 px screen. The
 * screens are opened on the local month and week the journey's drive lies
 * in, which the current ones are but for the first minutes of a month or week.
 */

/** Wide enough for the list beside the screen (64rem). */
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

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

/** The ISO week (`2026-W45`) of a local date. */
function isoWeek(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const first = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - first) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The local month and week the journey's drive started in, as the address names them. */
async function journeyPeriods(
  page: Page,
): Promise<{ month: string; week: string; current: string }> {
  const now = Date.now();
  const response = await page.request.get("/api/v1/segments", {
    params: {
      from: new Date(now - 2 * 86_400_000).toISOString(),
      to: new Date(now + 3_600_000).toISOString(),
    },
  });
  const drive = timelineResponseSchema
    .parse(await response.json())
    .items.filter((item) => item.kind === "move")
    .at(-1);
  if (drive === undefined) throw new Error("the drive is not there");
  const local = (instant: string | number) =>
    new Date(instant).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
  const day = local(drive.startedAt);
  return { month: day.slice(0, 7), week: isoWeek(day), current: local(now).slice(0, 7) };
}

test("Insights: the summary, its period, a mode, when you travel and roads", async ({
  page,
  account,
}) => {
  test.slow();
  await uploadedDevice(page, "Walker", walkAndDrive());
  expect(account.timezone).toBe("Europe/Brussels");
  await processed(page);
  const wide = isWide(page);
  const { month, week, current } = await journeyPeriods(page);
  const summary = `/insights?period=${month}`;
  const here = (path: string) => new RegExp(`${path}\\?period=${month}$`);

  // A second device, so that the options have something to choose.
  const second = await addDevice(page, "Second phone");
  await second.dialog.getByRole("button", { name: "Done" }).click();

  // The tab in the main navigation.
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Insights" })
    .click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeFocused();
  await page.goto(summary);

  // The distance of the month, one chart by day, the modes' list.
  const tiles = page.getByRole("group", { name: "Totals" });
  await expect(tiles.getByText("Distance", { exact: true })).toBeVisible();
  await expect(tiles).toContainText(/\d+ moves?/);
  await expect(tiles).toContainText("on the move");
  await expect(page.getByText(/^Nothing recorded in .+ to compare with\.$/)).toBeVisible();
  const series = page.getByRole("figure", { name: "Distance per day, by mode" });
  await expect(
    series.getByRole("img", { name: /^Mon|^Tue|^Wed|^Thu|^Fri|^Sat|^Sun/ }).first(),
  ).toBeAttached();
  const overview = insightsOverviewSchema.parse(
    await (
      await page.request.get("/api/v1/insights/overview", {
        params: { from: `${month}-01`, to: `${month}-28` },
      })
    ).json(),
  );
  expect(overview.modes.map((row) => row.mode)).toContain("car");
  const list = page.getByRole("navigation", { name: "Insights" });
  const car = list.getByRole("link", { name: /^Car \d/ });
  await expect(car).toBeVisible();
  if (wide) {
    // Beside the screen, with the summary as a row of its own and current.
    await expect(list.getByRole("link", { name: /^Summary/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  } else {
    // After the hero and the chart, as a part of the screen.
    await expect(list.getByRole("heading", { level: 2, name: "Modes" })).toBeVisible();
    expect((await series.boundingBox())?.y).toBeLessThan((await car.boundingBox())?.y ?? 0);
    await expect(list.getByRole("link", { name: /^Summary/ })).toHaveCount(0);
  }
  await expectAccessible(page, "the Insights summary");

  // A chart by keyboard: one tab stop, the arrow keys move along its marks.
  await page.getByRole("radio", { name: "Month" }).focus();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    if (await series.evaluate((figure) => figure.contains(document.activeElement))) break;
  }
  const firstMark = series.locator("[role='img']:focus");
  await expect(firstMark).toBeFocused();
  await expect(series.locator(".chart-tooltip")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(series.locator("[role='img']:focus")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(series.locator(".chart-tooltip")).toBeHidden();
  await expect(series.locator("[role='img']:focus")).toBeFocused();

  // The period: units, steps, a custom range in a popover. The address keeps it.
  const period = page.getByRole("group", { name: "Period" });
  await expect(period.getByRole("radio", { name: "Month" })).toBeChecked();
  if (month === current) {
    await expect(page.getByRole("button", { name: "Next month" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  await period.getByRole("radio", { name: "Week" }).click();
  await expect(page).toHaveURL(/\/insights\?period=(week|\d{4}-W\d{2})$/);
  await period.getByRole("radio", { name: "Year" }).click();
  await expect(page).toHaveURL(/\/insights\?period=(year|\d{4})$/);
  await period.getByRole("radio", { name: "Month" }).click();
  await expect(page).toHaveURL(/\/insights(\?period=\d{4}-\d{2})?$/);
  // The week of the drive.
  await page.goto(`/insights?period=${week}`);
  await expect(tiles.getByText("Distance", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous week" })).toBeVisible();
  await page.goto(summary);
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/\/insights\?period=\d{4}-\d{2}$/);
  await expect(page.getByRole("heading", { name: /^No moves in \w+ \d{4}$/ })).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page).toHaveURL(new RegExp(`/insights(\\?period=${month})?$`));
  await expect(tiles).toBeVisible();

  const label = page.getByRole("button", { name: /, choose a custom period$/ });
  await label.click();
  await expect(page.getByLabel("From")).toBeVisible();
  await expectAccessible(page, "the custom period popover");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("From")).toBeHidden();
  await expect(label).toBeFocused();

  // The options, with two devices: a note once one is left out, Advanced open at once.
  const options = page.getByRole("button", { name: "Options", exact: true });
  await options.click();
  await expect(page.getByRole("button", { name: "Advanced" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "Advanced" }).click();
  const devices = page.getByRole("group", { name: "Devices" });
  await expectAccessible(page, "the options popover");
  await devices.getByRole("checkbox", { name: "Second phone" }).click();
  await expect(page).toHaveURL(/devices=[0-9a-f-]{36}$/);
  await page.keyboard.press("Escape");
  await expect(devices).toBeHidden();
  await expect(page.getByRole("button", { name: "Options 1 of 2 devices" })).toBeFocused();
  await page.getByRole("button", { name: "Options 1 of 2 devices" }).click();
  await expect(page.getByRole("button", { name: "Advanced" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("Escape");

  // An address of before: the last 7 days, a custom range without steps.
  await page.goto("/insights?period=7d");
  await expect(tiles).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous month" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous week" })).toHaveCount(0);
  await page.goto(summary);

  // A mode's screen: the title takes focus; going back hands it to the row.
  await car.click();
  await expect(page).toHaveURL(here("/insights/transport/car"));
  await expect(page.getByRole("heading", { level: 1, name: "Car" })).toBeFocused();
  await expect(page.getByRole("figure", { name: "Distance per day" })).toBeVisible();
  await expect(tiles.getByText("Distance", { exact: true })).toBeVisible();
  await expect(tiles).toContainText("typically");
  await expectAccessible(page, "the mode screen");

  // Its rows: each a screen of its own with the title in focus, and the way back to the row.
  const mode = page.getByRole("region", { name: "Car" });
  const backToCar = page.getByRole("link", { name: "Back to Car" });
  await mode.getByRole("link", { name: /^Speed / }).click();
  await expect(page).toHaveURL(here("/insights/transport/car/speed"));
  await expect(page.getByRole("heading", { level: 1, name: "Speed" })).toBeFocused();
  await expect(page.getByRole("figure", { name: "Moves by speed" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Totals" })).toContainText("Typical speed");
  await expect(page.getByRole("link", { name: /^Fastest move / })).toBeVisible();
  await expectAccessible(page, "a mode's Speed");
  await backToCar.click();
  await expect(page).toHaveURL(here("/insights/transport/car"));
  await expect(mode.getByRole("link", { name: /^Speed / })).toBeFocused();

  await mode.getByRole("link", { name: /^When / }).click();
  await expect(page).toHaveURL(here("/insights/transport/car/time"));
  await expect(page.getByRole("heading", { level: 1, name: "When" })).toBeFocused();
  await expect(page.getByRole("figure", { name: "Time by car by weekday and hour" })).toBeVisible();
  await expectAccessible(page, "a mode's When");
  await backToCar.click();

  await mode.getByRole("link", { name: /^Roads/ }).click();
  await expect(page).toHaveURL(here("/insights/transport/car/roads"));
  await expect(page.getByRole("heading", { level: 1, name: "Roads" })).toBeFocused();
  await expect(page.getByText("No map data for these moves")).toBeVisible();
  await expectAccessible(page, "a mode's Roads");
  await backToCar.click();

  // A longest move opens its day in History, with its details.
  await mode.getByRole("link", { name: /^Longest moves / }).click();
  await expect(page).toHaveURL(here("/insights/transport/car/moves"));
  await expect(page.getByRole("heading", { level: 1, name: "Longest moves" })).toBeFocused();
  await expectAccessible(page, "a mode's Longest moves");
  await page
    .getByRole("region", { name: "Longest moves" })
    .getByRole("link", { name: /\d{2}:\d{2} / })
    .first()
    .click();
  await expect(page).toHaveURL(
    /\/\?view=history&date=\d{4}-\d{2}-\d{2}&(person=me&segment=[0-9a-f-]{36}|segment=[0-9a-f-]{36}&person=me)$/,
  );
  const dialog = page.getByRole("dialog", { name: "Car" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await page.goto(summary);
  await car.click();
  await expect(page.getByRole("heading", { level: 1, name: "Car" })).toBeFocused();
  if (wide) {
    await expect(list.getByRole("link", { name: /^Car \d/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  } else {
    await page.getByRole("link", { name: "Back to Insights" }).click();
    await expect(page).toHaveURL(here("/insights"));
    await expect(page.getByRole("link", { name: /^Car \d/ })).toBeFocused();
  }

  // When you travel: the hours of the week, for every mode or the one the address names.
  await page.goto(summary);
  await list.getByRole("link", { name: "When you travel" }).click();
  await expect(page).toHaveURL(here("/insights/time"));
  await expect(page.getByRole("heading", { level: 1, name: "When you travel" })).toBeFocused();
  const grid = page.getByRole("figure", { name: "Time on the move by weekday and hour" });
  await expect(grid).toBeVisible();
  await expect(grid).toHaveAccessibleDescription(/^Most often on \w+day at \d{2}:00/);
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveCount(0);
  await expectAccessible(page, "When you travel");
  // The When of before, with a mode in the address, is the mode's own screen.
  await page.goto(`/insights/time?period=${month}&mode=walking`);
  await expect(page).toHaveURL(here("/insights/transport/walking/time"));
  await expect(
    page.getByRole("figure", { name: "Time by walking by weekday and hour" }),
  ).toBeVisible();
  await page.goto("/insights/roads?mode=walking&period=month");
  await expect(page).toHaveURL(/\/insights\/transport\/walking\/roads\?period=month$/);

  // Roads: this server has no map data, and says so.
  await page.goto(summary);
  await list.getByRole("link", { name: "Roads" }).click();
  await expect(page).toHaveURL(here("/insights/roads"));
  await expect(page.getByRole("heading", { level: 1, name: "Roads" })).toBeVisible();
  await expect(page.getByText("No map data for these moves")).toBeVisible();
  await expectAccessible(page, "Roads");
});

test("Insights: places, a place and its days, and the day in History", async ({
  page,
  account,
}) => {
  test.slow();
  await uploadedDevice(page, "Stayer", stayAndWalk());
  expect(account.timezone).toBe("Europe/Brussels");
  const wide = isWide(page);
  // Waits until the stay is a place (the worker runs seconds after the upload).
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/insights/places");
        const body = (await response.json()) as { totals?: { places?: number } };
        return body.totals?.places ?? 0;
      },
      { timeout: 45_000, intervals: [1_000] },
    )
    .toBeGreaterThan(0);
  const { month } = await journeyPeriods(page);
  const summary = `/insights?period=${month}`;
  const here = (path: string) => new RegExp(`${path}\\?period=${month}$`);

  await page.goto(summary);
  const list = page.getByRole("navigation", { name: "Insights" });
  await list.getByRole("link", { name: "Places" }).click();
  await expect(page).toHaveURL(here("/insights/places"));
  await expect(page.getByRole("heading", { level: 1, name: "Places" })).toBeFocused();
  const tiles = page.getByRole("group", { name: "Totals" });
  await expect(tiles).toContainText(/\d+ visits?/);
  await expect(page.getByRole("figure", { name: "Time at your top places" })).toBeVisible();
  await expectAccessible(page, "Places");

  // A place: the title takes focus; its days lead to History.
  const place = page
    .getByRole("region", { name: "Places" })
    .getByRole("link", { name: / · \d+ visits?$/ })
    .first();
  await place.click();
  await expect(page).toHaveURL(/\/insights\/place\?period=[\d-]+&place=\d+\.\d+$/);
  const key = new URL(page.url()).searchParams.get("place") ?? "";
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(tiles.getByText("Time here")).toBeVisible();
  await expect(page.getByRole("figure", { name: "Time here per day" })).toBeVisible();
  await expect(page.getByText("First here")).toBeVisible();
  await expectAccessible(page, "a place");

  // All the days at the place.
  await page.goto(`/insights/place/days?period=${month}&place=${key}`);
  await expect(page.getByRole("heading", { level: 1, name: "Days" })).toBeVisible();
  await expect(tiles).toContainText(/\d+ days?/);
  await expectAccessible(page, "the days at a place");

  // A day opens in History, as the person themselves.
  await page
    .getByRole("region", { name: "Days" })
    .getByRole("link", { name: /\d+ (mins?|hrs?)/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/\?view=history&date=\d{4}-\d{2}-\d{2}&person=me$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

  // Back to the place and to the row of it among the places.
  await page.goto(`/insights/places?period=${month}`);
  await page
    .getByRole("region", { name: "Places" })
    .getByRole("link", { name: / visits?$/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Back to Places" }).click();
  await expect(page).toHaveURL(here("/insights/places"));
  await expect(
    page
      .getByRole("region", { name: "Places" })
      .getByRole("link", { name: / visits?$/ })
      .first(),
  ).toBeFocused();
  if (wide) {
    await expect(list.getByRole("link", { name: "Places" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test.describe("on a 320 px wide screen", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("Insights fit and stay accessible", async ({ page, account }) => {
    test.slow();
    expect(account.timezone).toBe("Europe/Brussels");
    await uploadedDevice(page, "Narrow walker", walkAndDrive());
    await processed(page);
    const { month } = await journeyPeriods(page);
    const second = await addDevice(page, "Second phone");
    await second.dialog.getByRole("button", { name: "Done" }).click();
    for (const [path, heading, loaded] of [
      ["/insights", "Insights", "Distance per day, by mode"],
      ["/insights/transport/car", "Car", "Distance per day"],
      ["/insights/time", "When you travel", "Time on the move by weekday and hour"],
      ["/insights/roads", "Roads", "No map data for these moves"],
      ["/insights/transport/walking/time", "When", "Time by walking by weekday and hour"],
      ["/insights/transport/walking/roads", "Roads", "No map data for these moves"],
      ["/insights/transport/walking/speed", "Speed", "Moves by speed"],
      ["/insights/transport/walking/moves", "Longest moves", "Longest move"],
    ] as const) {
      await page.goto(`${path}?period=${month}`);
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(loaded).first()).toBeVisible();
      expect(await overflow(page), path).toBe(0);
      await expectAccessible(page, `${path} at 320 px`);
    }
    // The popovers fit too.
    await page.goto(`/insights?period=${month}`);
    await page.getByRole("button", { name: /, choose a custom period$/ }).click();
    await expect(page.getByLabel("From")).toBeVisible();
    expect(await overflow(page), "the period popover").toBe(0);
    await expectAccessible(page, "the period popover at 320 px");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByRole("group", { name: "Devices" })).toBeVisible();
    expect(await overflow(page), "the options popover").toBe(0);
    await expectAccessible(page, "the options popover at 320 px");
  });
});
