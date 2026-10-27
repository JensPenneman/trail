import { expect } from "@playwright/test";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { fact } from "./support/deviceCard";
import { heatPixels } from "./support/heatPixels";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

test("Heat draws the heatmap of every point and lists the busiest places", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Explorer", overlandBatch(account.timezone));
  const heatmap = page.waitForResponse((response) => response.url().includes("/api/heatmap?"));
  await page.goto("/?view=heat");
  // The cells in view: the camera starts around the phone's latest position.
  const { cells, cellZoom } = heatmapResponseSchema.parse(await (await heatmap).json());
  const counted = cells.reduce((sum, [, , count]) => sum + count, 0);
  expect(counted).toBeGreaterThan(0);
  expect(counted).toBeLessThanOrEqual(30);
  expect(cellZoom).toBeGreaterThanOrEqual(6);
  expect(cellZoom).toBeLessThanOrEqual(18);

  await expect(page.getByRole("region", { name: /^Heatmap of all recorded points/ })).toBeVisible();
  // The squares are on the map, in the ramp's colours.
  await expect.poll(() => heatPixels(page), { timeout: 15_000 }).toBeGreaterThan(0);

  // The key says what the colours stand for, from the fewest points to the most.
  const legend = page.getByRole("list", { name: "Points recorded in each square" });
  const classes = legend.getByRole("listitem");
  await expect(classes.first()).toHaveText(/^\d[\d,]*(–\d[\d,]*)?$|or more$/);
  await expect(classes.last()).toHaveText(/^\d[\d,]* or more$/);

  const busiest = page
    .getByRole("region", { name: "Busiest places in view" })
    .getByRole("listitem");
  await expect(busiest.first()).toContainText(/\d+ points/);
  await expect(
    fact(page.getByRole("region", { name: "Totals", exact: true }), "Points"),
  ).toHaveText("30");
  await busiest.first().getByRole("button", { name: "Show this place on the map" }).click();
});
