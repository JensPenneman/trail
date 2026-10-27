import { expect, type Page } from "@playwright/test";
import {
  levelTracksResponseSchema,
  type ProcessingLevel,
  timelineResponseSchema,
} from "@trail/contracts/transport";
import { expectAccessible } from "./support/expectAccessible";
import { openMapOptions } from "./support/mapControls";
import {
  dayStartMarginMs,
  type OverlandBatch,
  type OverlandFeature,
  overlandBatch,
  startOfToday,
} from "./support/overlandBatch";
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

/**
 * Seventy-five minutes of today, on foot near Ghent: a walk, a stop in which
 * the phone shuffles 40 m (a stop that spread), a walk away, then nothing for
 * 45 minutes and a walk 2 km further on (a gap with travel). It ends a few
 * minutes ago — or, early in the day, starts after midnight and reaches ahead.
 */
function stopAndGapBatch(timeZone: string, now = Date.now()): OverlandBatch {
  const durationMs = 75 * 60_000;
  const start = Math.max(
    now - durationMs - 120_000,
    startOfToday(now, timeZone) + dayStartMarginMs,
  );
  const origin = { lat: 51.05, lon: 3.72 };
  const locations: OverlandFeature[] = [];
  /** Metres east and north of the origin at `seconds` after the start. */
  const at = (seconds: number, east: number, north: number, speed: number, motion: string[]) =>
    locations.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [origin.lon + east / 69_930, origin.lat + north / 111_195],
      },
      properties: {
        timestamp: new Date(start + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        horizontal_accuracy: 5,
        speed,
        motion,
      },
    });
  let t = 0;
  // Ten minutes on foot, eastwards: 840 m.
  for (; t <= 600; t += 5) at(t, (t / 600) * 840, 0, 1.4, ["walking"]);
  // The stop: four minutes still, 40 m north at a shuffle, four minutes still.
  for (t = 605; t <= 845; t += 5) at(t, 840, 0, 0, ["stationary"]);
  for (t = 850; t <= 950; t += 5) at(t, 840, ((t - 845) / 100) * 40, 0.4, []);
  for (t = 955; t <= 1195; t += 5) at(t, 840, 40, 0, ["stationary"]);
  // Off again: three minutes on foot.
  for (t = 1200; t <= 1380; t += 5) at(t, 840 + ((t - 1195) / 180) * 250, 40, 1.4, ["walking"]);
  // The phone records nothing for 45 minutes and wakes up 2 km on.
  for (t = 4080; t <= 4380; t += 5) at(t, 3100 + ((t - 4080) / 300) * 400, 900, 1.4, ["walking"]);
  return { locations };
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

  await page.goto("/?view=history");
  await openMapOptions(page);
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
  await page.goto("/?view=history");
  await openMapOptions(page);
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

test("a stop shows the walk within it, and a silent phone shows as no data", async ({
  page,
  account,
}) => {
  await uploadedDevice(page, "Walker", stopAndGapBatch(account.timezone));
  await processed(page);

  // What the map is given: the stop's place and the points within it, and a jump after the gap.
  const tracks = await tracksAt(page, "inferred");
  const stop = tracks.segments.find((segment) => segment.kind === "stop");
  expect(stop?.centroid).not.toBeNull();
  expect(stop?.points.length).toBeGreaterThan(1);
  const moves = tracks.segments.filter((segment) => segment.kind === "move");
  expect(moves.length).toBeGreaterThanOrEqual(3);

  await page.goto("/?view=history");
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByText(/^No data · 4[45] mins$/)).toBeVisible();
  const legend = page.getByRole("region", { name: "Map legend" });
  await expect(legend.getByText("Moved within a stop")).toBeVisible();
  await expect(legend.getByText("No data: a gap in the recording")).toBeVisible();
  await expectAccessible(page, "History with a stop's walk and a gap");

  await timeline.getByRole("button", { name: /^Details of the stop from/ }).click();
  const dialog = page.getByRole("dialog", { name: "Stop" });
  await expect(dialog.getByText("Moved within")).toBeVisible();
  await expect(dialog.getByText(/^\d+ m$/)).toBeVisible();
  await expectAccessible(page, "a stop's dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the quick toggle on the Me card says how you travel from now on", async ({
  page,
  account,
}) => {
  const commuter = await uploadedDevice(page, "Commuter", overlandBatch(account.timezone));
  await page.goto("/");
  const me = page.getByRole("region", { name: "Me", exact: true });
  const chips = me.getByRole("group", { name: "Now:" });
  await expect(chips).toHaveAccessibleDescription(
    "Until you stop for 10 minutes or more, for Commuter.",
  );
  await expect(chips.getByRole("button", { name: /^Auto/, pressed: true })).toBeVisible();
  await chips.getByRole("button", { name: "Train" }).click();
  await expect(chips.getByRole("button", { name: "Train", pressed: true })).toBeVisible();
  // What Me is doing follows: by train now (no-break spaces keep its words together).
  await expect(me.getByText(/^By\strain/)).toBeVisible();
  await expectAccessible(page, "People with the quick toggle");

  await page.reload();
  const again = me.getByRole("group", { name: "Now:" });
  await expect(again.getByRole("button", { name: "Train", pressed: true })).toBeVisible();
  await again.getByRole("button", { name: "Other" }).click();
  const other = page.getByRole("dialog", { name: "How are you travelling?" });
  await other.getByRole("button", { name: "Boat" }).click();
  await expect(again.getByRole("button", { name: "Other: Boat", pressed: true })).toBeVisible();

  // The same device's page has the same toggle, set to the same.
  await page.goto(`/devices/${commuter.id}`);
  const onItsPage = page
    .getByRole("region", { name: "Travelling now" })
    .getByRole("group", { name: "Now:" });
  await expect(onItsPage.getByRole("button", { name: "Other: Boat", pressed: true })).toBeVisible();
  await onItsPage.getByRole("button", { name: /^Auto/ }).click();
  await expect(onItsPage.getByRole("button", { name: /^Auto/, pressed: true })).toBeVisible();
});
