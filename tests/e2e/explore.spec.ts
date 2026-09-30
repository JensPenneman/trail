import { expect } from "@playwright/test";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { fact } from "./support/deviceCard";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

test("Explore draws the heatmap of every point and lists the busiest places", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Explorer", overlandBatch(account.timezone));
  const heatmap = page.waitForResponse((response) => response.url().includes("/api/heatmap?"));
  await page.goto("/explore");
  // The cells in view: the camera starts around the phone's latest position.
  const { cells } = heatmapResponseSchema.parse(await (await heatmap).json());
  const counted = cells.reduce((sum, [, , count]) => sum + count, 0);
  expect(counted).toBeGreaterThan(0);
  expect(counted).toBeLessThanOrEqual(30);

  await expect(page.getByRole("region", { name: /^Heatmap of all recorded points/ })).toBeVisible();
  const busiest = page
    .getByRole("region", { name: "Busiest places in view" })
    .getByRole("listitem");
  await expect(busiest.first()).toContainText(/\d+ points/);
  await expect(
    fact(page.getByRole("region", { name: "Totals", exact: true }), "Points"),
  ).toHaveText("30");
  await busiest.first().getByRole("button", { name: "Show this place on the map" }).click();
});
