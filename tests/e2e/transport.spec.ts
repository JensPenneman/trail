import { expect, type Page } from "@playwright/test";
import {
  levelTracksResponseSchema,
  type ProcessingLevel,
  timelineResponseSchema,
} from "@trail/contracts/transport";
import { deviceCard } from "./support/deviceCard";
import { expectAccessible } from "./support/expectAccessible";
import { type OverlandBatch, overlandBatch } from "./support/overlandBatch";
import { postOverland } from "./support/postOverland";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

const day = (now = Date.now()) => ({
  from: new Date(now - 2 * 86_400_000).toISOString(),
  to: new Date(now + 86_400_000).toISOString(),
});

/** Five minutes of a phone lying still after the ride: raw jitter that averaging collapses. */
function restAfter(batch: OverlandBatch): OverlandBatch {
  const points = batch.locations.filter(
    (record) =>
      record.properties["action"] === undefined && record.properties["type"] === undefined,
  );
  const last = points.at(-1);
  const [lon, lat] = last?.geometry?.coordinates ?? [3.5328, 50.9853];
  const start = Date.parse(String(last?.properties["timestamp"])) / 1000 + 30;
  return {
    locations: Array.from({ length: 300 }, (_, index) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          (lon ?? 0) + ((index % 7) - 3) * 0.00006,
          (lat ?? 0) + ((index % 5) - 2) * 0.00005,
        ],
      },
      properties: {
        timestamp: new Date((start + index) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        horizontal_accuracy: 10,
        speed: 0,
        motion: ["stationary"],
      },
    })),
  };
}

/** Waits until processing has turned the uploads into a move (the worker runs a few seconds later). */
async function processed(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/segments", { params: day() });
        const timeline = timelineResponseSchema.parse(await response.json());
        return timeline.items.some((segment) => segment.kind === "move") && !timeline.pending;
      },
      { timeout: 45_000, intervals: [1_000] },
    )
    .toBe(true);
}

async function tracksAt(page: Page, level: ProcessingLevel) {
  const response = await page.request.get("/api/v1/tracks", { params: { ...day(), level } });
  return levelTracksResponseSchema.parse(await response.json());
}

test("levels change the tracks, and a move's mode can be put right", async ({ page, account }) => {
  const batch = overlandBatch(account.timezone);
  const device = await uploadedDevice(page, "Cyclist", batch);
  expect((await postOverland(page.request, device.token, restAfter(batch))).status()).toBe(200);
  await processed(page);

  // The rest after the ride: 300 raw positions, one averaged.
  const distinct = async (level: ProcessingLevel) =>
    new Set(
      (await tracksAt(page, level)).segments.flatMap((segment) =>
        segment.points.map(([lon, lat]) => `${lon},${lat}`),
      ),
    ).size;
  expect(await distinct("raw")).toBeGreaterThan(await distinct("averaged"));

  await page.goto("/history");
  const level = page.getByRole("group", { name: "Detail of the tracks" });
  await expect(level.getByRole("radio", { name: "Transport" })).toBeChecked();
  const legend = page.getByRole("region", { name: "Map legend" });
  await expect(legend.getByText("Cycling")).toBeVisible();
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByText(/^Cycling · \d+(\.\d)? km/)).toBeVisible();
  await expectAccessible(page, "History at the Transport level");

  // Switching levels fetches other lines for the map.
  const averaged = page.waitForResponse((response) => response.url().includes("level=averaged"));
  await level.getByRole("radio", { name: "Averaged" }).click();
  await expect(level.getByRole("radio", { name: "Averaged" })).toBeChecked();
  const averagedBody = levelTracksResponseSchema.parse(await (await averaged).json());
  expect(averagedBody.availableLevel).toBe("averaged");
  await expect(page).toHaveURL(/level=averaged/);
  await expect(page.getByText("Outliers dropped and GPS noise smoothed.")).toBeVisible();
  const mapped = page.waitForResponse((response) => response.url().includes("level=mapped"));
  await level.getByRole("radio", { name: "Mapped" }).click();
  await expect(level.getByRole("radio", { name: "Mapped" })).toBeChecked();
  expect(levelTracksResponseSchema.parse(await (await mapped).json()).availableLevel).toBe(
    "averaged",
  );
  await expect(
    page.getByText("Map data is not there for all of it yet: some lines are averaged."),
  ).toBeVisible();
  await level.getByRole("radio", { name: "Raw" }).click();
  await expect(level.getByRole("radio", { name: "Raw" })).toBeChecked();
  await expect(page).toHaveURL(/level=raw/);
  // The choice is remembered on this browser.
  await page.goto("/history");
  await expect(page.getByRole("radio", { name: "Raw" })).toBeChecked();
  await page.getByRole("radio", { name: "Transport" }).click();
  await expect(page.getByRole("radio", { name: "Transport" })).toBeChecked();

  // Open the ride, call it a bus ride, then hand it back to the inference.
  await page.getByRole("button", { name: /^Details of the cycling from/ }).click();
  // The dialog is named after the mode, which changes below: find it by role alone.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Cycling");
  await expect(dialog.getByText("Average speed")).toBeVisible();
  await expectAccessible(page, "the segment dialog");
  await dialog.getByRole("button", { name: "Bus" }).click();
  await expect(dialog.getByText("Saved: Bus.")).toBeVisible();
  await expect(dialog).toHaveAccessibleName("Bus");
  await expect(dialog.getByText("set by you")).toBeVisible();
  const corrected = await page.request.get("/api/v1/segments", { params: day() });
  const move = timelineResponseSchema
    .parse(await corrected.json())
    .items.find((segment) => segment.kind === "move");
  expect(move).toMatchObject({ mode: "bus", modeUser: "bus", modeInferred: "cycling" });
  await dialog.getByRole("button", { name: "Reset to detected" }).click();
  await expect(dialog.getByText("Back to the detected mode: Cycling.")).toBeVisible();
  await expect(dialog).toHaveAccessibleName("Cycling");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Timeline" }).getByText("set by you")).toHaveCount(
    0,
  );
});

test("the quick toggle on Live says how you travel from now on", async ({ page, account }) => {
  await uploadedDevice(page, "Commuter", overlandBatch(account.timezone));
  await page.goto("/");
  const chips = deviceCard(page, "Commuter").getByRole("group", { name: "Now:" });
  await expect(chips.getByRole("button", { name: /^Auto/, pressed: true })).toBeVisible();
  await chips.getByRole("button", { name: "Train" }).click();
  await expect(chips.getByRole("button", { name: "Train", pressed: true })).toBeVisible();
  await expectAccessible(page, "Live with the quick toggle");

  await page.reload();
  const again = deviceCard(page, "Commuter").getByRole("group", { name: "Now:" });
  await expect(again.getByRole("button", { name: "Train", pressed: true })).toBeVisible();
  await again.getByRole("button", { name: "Other" }).click();
  const other = page.getByRole("dialog", { name: "How is Commuter travelling?" });
  await other.getByRole("button", { name: "Boat" }).click();
  await expect(again.getByRole("button", { name: "Other: Boat", pressed: true })).toBeVisible();
  await again.getByRole("button", { name: /^Auto/ }).click();
  await expect(again.getByRole("button", { name: /^Auto/, pressed: true })).toBeVisible();
});
