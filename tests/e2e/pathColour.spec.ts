import { expect } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { linePixels } from "./support/linePixels";
import { openMapOptions } from "./support/mapControls";
import { speedRampLight } from "./support/pathPalette";
import { sharingFriend } from "./support/sharingFriend";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";
import { walkAndDrive, walksOnly } from "./support/walkAndDrive";

/*
 * Colour by (docs/architecture.md §14): the lines of the tracks drawn by speed, in the ramp's colours,
 * with the key over the map, and by device, mode and time of day through the same select. A walk of
 * 1.4 m/s and a drive of 13.9 m/s (50 km/h) fall in the first and the fourth class of the ramp.
 */
const slow = speedRampLight[0] ?? "";
const fast = speedRampLight[3] ?? "";

test("Speed colours the walk and the drive apart, with the key over the map", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Walker", walkAndDrive());
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?view=history&person=me&level=raw");
  await openMapOptions(page);
  const colourBy = page.getByRole("combobox", { name: "Colour by" });
  // Raw has no modes: device first, and the colour a device has.
  await expect(colourBy).toHaveValue("device");
  await expect(colourBy.getByRole("option")).toHaveText([
    "Device",
    "Speed",
    "Time of day",
    "Altitude",
    "Accuracy",
  ]);
  await expectAccessible(page, "Colour by with the device legend");
  await colourBy.selectOption("speed");
  await expect(page).toHaveURL(/[?&]color=speed/);
  await page.keyboard.press("Escape");

  // The slow walk and the fast drive are two colours of the ramp, nothing else of the ramp.
  await expect
    .poll(async () => (await linePixels(page, [slow, fast])).every((count) => count > 0), {
      timeout: 30_000,
    })
    .toBe(true);
  const key = page.getByRole("list", { name: "Speed" });
  await expect(key).toBeVisible();
  await expect(key.getByText("under 6 km/h")).toBeVisible();
  await expect(key.getByText("70 km/h or more")).toBeVisible();
  await expectAccessible(page, "The speed key over the map");

  // Transport: by mode again, after the browser remembered Speed, then by time of day.
  await page.goto("/?view=history&person=me&level=inferred");
  await openMapOptions(page);
  await expect(page.getByRole("combobox", { name: "Colour by" })).toHaveValue("speed");
  await page.getByRole("combobox", { name: "Colour by" }).selectOption("mode");
  await expect(page.getByRole("region", { name: "Map legend" })).toBeVisible();
  await page.getByRole("combobox", { name: "Colour by" }).selectOption("time");
  const legend = page.getByRole("region", { name: "Map legend" });
  await expect(legend.getByText("Night 22–06")).toBeVisible();
  await expect(legend.getByText("Evening 18–22")).toBeVisible();
  await expectAccessible(page, "Colour by time of day with its legend");
  expect(account.timezone).not.toBe("");
});

test.describe("on a wide map", () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test("the speed key stacks above History's slider, and nothing covers it", async ({
    page,
    account,
  }) => {
    expect(account.email).toBeTruthy();
    await uploadedDevice(page, "Walker", walkAndDrive());
    await page.goto("/?view=history&person=me&level=raw&color=speed");
    const key = page.getByRole("list", { name: "Speed" });
    await expect(key).toBeVisible();
    const foot = page.locator(".map-page__foot");
    await expect(foot).toBeVisible();
    const keyBox = await page.locator(".map-page__legend").boundingBox();
    const footBox = await foot.boundingBox();
    if (keyBox === null || footBox === null)
      throw new Error("The key or the slider is not laid out");
    expect(keyBox.y + keyBox.height).toBeLessThanOrEqual(footBox.y + 0.5);
    // What is at the middle of the key is the key: nothing lies over it.
    const covered = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest(".map-page__legend") === null,
      { x: keyBox.x + keyBox.width / 2, y: keyBox.y + keyBox.height / 2 },
    );
    expect(covered).toBe(false);
  });
});

test("a sharer drawn on the overview is a row of the device legend, by name", async ({
  page,
  account,
  openBrowser,
}) => {
  test.slow();
  await uploadedDevice(page, "Walker", walkAndDrive());
  const friend = await sharingFriend(openBrowser, account, "drawn", {
    precision: "precise",
    historyDays: 7,
  });
  await page.goto("/?view=history&level=raw&color=device");
  await openMapOptions(page);
  const colourBy = page.getByRole("combobox", { name: "Colour by" });
  await expect(colourBy.getByRole("option", { name: "Device or person" })).toBeAttached({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("region", { name: "Map legend" }).getByText(friend.account.displayName),
  ).toBeVisible();
});

test("on foot the key is a pace, from slower to faster", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await uploadedDevice(page, "Walker", walksOnly());
  await page.goto("/?view=history&person=me&level=inferred&color=speed");
  const key = page.getByRole("list", { name: "Pace" });
  await expect(key).toBeVisible({ timeout: 30_000 });
  await expect(key.getByText(/^slower than 12:00/)).toBeVisible();
  await expect(key.getByText(/^faster than 5:30/)).toBeVisible();
  await expectAccessible(page, "The pace key over the map");
});

test("Accuracy at Averaged colours by fixed metres and shows its key", async ({
  page,
  account,
}) => {
  expect(account.email).toBeTruthy();
  await uploadedDevice(page, "Walker", walkAndDrive());
  await page.goto("/?view=history&person=me&level=averaged&color=accuracy");
  const key = page.getByRole("list", { name: "Accuracy" });
  await expect(key).toBeVisible({ timeout: 30_000 });
  await expect(key.getByText("10 m or better")).toBeVisible();
  await expect(key.getByText("worse than 100 m")).toBeVisible();
  // The level's tracks were asked for the accuracy, and only for that.
  await openMapOptions(page);
  await expect(page.getByRole("combobox", { name: "Colour by" })).toHaveValue("accuracy");
  await expectAccessible(page, "The accuracy key over the map");
});
