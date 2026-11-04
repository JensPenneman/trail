import { expect } from "@playwright/test";
import { speedRamp } from "../../apps/web/src/map/pathColour/pathPalette";
import { expectAccessible } from "./support/expectAccessible";
import { linePixels } from "./support/linePixels";
import { openMapOptions } from "./support/mapControls";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";
import { walkAndDrive } from "./support/walkAndDrive";

/*
 * Colour by (docs/architecture.md §14): the lines of the tracks drawn by speed, in the ramp's colours,
 * with the key over the map, and by device, mode and time of day through the same select. A walk of
 * 1.4 m/s and a drive of 13.9 m/s (50 km/h) fall in the first and the fourth class of the ramp.
 */
const slow = speedRamp.light[0] ?? "";
const fast = speedRamp.light[3] ?? "";

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
  await expect(colourBy.getByRole("option")).toHaveText(["Device", "Speed", "Time of day"]);
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
