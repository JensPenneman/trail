import { expect } from "@playwright/test";
import { publicConfigSchema } from "@trail/contracts/config";
import { deviceCard } from "./support/deviceCard";
import { expectAccessible } from "./support/expectAccessible";
import { localDate, mapView, openMapOptions } from "./support/mapControls";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/** Marks the map's canvas, so a later check can tell whether it is still the same one. */
const canvasMarked = "trailE2eMapCanvas";

test("Live, History and Heat share one map and keep their place in the URL", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Viewed phone", overlandBatch(account.timezone));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeVisible();
  await expect(mapView(page, "Live")).toBeChecked();
  await expect(deviceCard(page, "Viewed phone")).toBeVisible();
  await expect(page).toHaveTitle("Live · Map · Trail");
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toHaveAccessibleName(/^Map of today’s tracks/);
  await canvas.evaluate((element, name) => Reflect.set(window, name, element), canvasMarked);
  const sameCanvas = () =>
    canvas.evaluate((element, name) => element === Reflect.get(window, name), canvasMarked);

  await mapView(page, "History").click();
  await expect(page).toHaveURL(/\/\?view=history$/);
  await expect(page.getByRole("region", { name: "Summary", exact: true })).toContainText(
    "30 points",
  );
  await expect(page.getByRole("slider", { name: "Position at" })).toBeVisible();
  await expect(page).toHaveTitle("History · Map · Trail");
  // Switching keeps focus on the switch, where the person is.
  await expect(mapView(page, "History")).toBeFocused();

  await mapView(page, "Heat").click();
  await expect(page).toHaveURL(/\/\?view=heat$/);
  await expect(canvas).toHaveAccessibleName(/^Heatmap of all recorded points/);
  await expect(
    page.getByRole("region", { name: "Busiest places in view" }).getByRole("listitem").first(),
  ).toContainText(/\d+ points/);
  expect(await sameCanvas()).toBe(true);

  // Back goes through the views again, on the same map.
  await page.goBack();
  await expect(mapView(page, "History")).toBeChecked();
  await page.goBack();
  await expect(mapView(page, "Live")).toBeChecked();
  await expect(deviceCard(page, "Viewed phone")).toBeVisible();
  expect(await sameCanvas()).toBe(true);
});

test("the old addresses of History and Explore, and deep links, open the right view", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Linked phone", overlandBatch(account.timezone));
  const yesterday = localDate(account.timezone, -1);
  const weekAgo = localDate(account.timezone, -6);
  const today = localDate(account.timezone);

  await page.goto(`/history?date=${yesterday}&level=raw`);
  await expect(page).toHaveURL(new RegExp(`/\\?view=history&date=${yesterday}&level=raw$`));
  await expect(mapView(page, "History")).toBeChecked();
  await expect(page.getByRole("button", { name: /, choose another day$/ })).toContainText(
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric" }).format(
      Date.parse(`${yesterday}T12:00:00Z`),
    ),
  );
  await openMapOptions(page);
  await expect(page.getByRole("radio", { name: "Raw" })).toBeChecked();

  await page.goto("/explore");
  await expect(page).toHaveURL(/\/\?view=heat$/);
  await expect(mapView(page, "Heat")).toBeChecked();
  // The old address was replaced: Back skips it.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/\\?view=history&date=${yesterday}&level=raw$`));

  await page.goto(`/?view=history&from=${weekAgo}&to=${today}`);
  await expect(page.getByRole("radio", { name: "Period" })).toBeChecked();
  await expect(page.getByRole("region", { name: "Summary", exact: true })).toContainText(
    "Linked phone",
  );

  await page.goto("/?view=elsewhere");
  await expect(mapView(page, "Live")).toBeChecked();
});

test("the device filter narrows every view and stays in the URL", async ({ page, account }) => {
  await uploadedDevice(page, "Kept phone", overlandBatch(account.timezone));
  await uploadedDevice(page, "Dropped phone", overlandBatch(account.timezone));
  await page.goto("/");
  await expect(deviceCard(page, "Dropped phone")).toBeVisible();
  await openMapOptions(page);
  const filter = page.getByRole("group", { name: "Devices" });
  await filter.getByRole("checkbox", { name: "Dropped phone" }).uncheck();
  await expect(page).toHaveURL(/[?&]devices=[0-9a-f-]{36}$/);
  await expect(deviceCard(page, "Dropped phone")).toHaveCount(0);
  await expect(deviceCard(page, "Kept phone")).toBeVisible();
  // The last device stays: an empty map explains nothing.
  await expect(filter.getByRole("checkbox", { name: "Kept phone" })).toBeDisabled();

  await mapView(page, "History").click();
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  await expect(summary).toContainText("Kept phone");
  await page.reload();
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  await expect(mapView(page, "History")).toBeChecked();
});

test("the map style: Auto follows the system, a choice is remembered, Satellite shows imagery", async ({
  page,
  account,
}) => {
  expect(account.email).toBeTruthy();
  const config = publicConfigSchema.parse(await (await page.request.get("/api/config")).json());
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = page.waitForRequest(config.mapStyles.dark);
  await page.goto("/");
  await dark;
  await openMapOptions(page);
  const control = page.getByRole("group", { name: "Map style" });
  await expect(control.getByRole("radio", { name: "Auto" })).toBeChecked();

  const light = page.waitForRequest(config.mapStyles.light);
  await control.getByRole("radio", { name: "Light" }).click();
  await light;
  await expect(page).toHaveURL(/[?&]style=light$/);
  // Remembered on this browser: an address without the choice opens with it.
  await page.goto("/?view=history");
  await openMapOptions(page);
  await expect(control.getByRole("radio", { name: "Light" })).toBeChecked();

  test.skip(
    config.mapStyles.satellite === undefined,
    "This server has no satellite imagery (MAP_STYLE_SATELLITE)",
  );
  const tile = page.waitForRequest((request) =>
    request.url().startsWith("https://imagery.e2e.trail.test/"),
  );
  await control.getByRole("radio", { name: "Satellite" }).click();
  await tile;
  await expect(page).toHaveURL(/[?&]style=satellite$/);
  await expect(page.getByText("Imagery for the end-to-end tests")).toBeVisible();
  await expectAccessible(page, "History on satellite imagery");
});
