import { expect } from "@playwright/test";
import { daysResponseSchema } from "@trail/contracts/stats";
import { tracksResponseSchema } from "@trail/contracts/track";
import { overlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

test("History shows today's distance, points, visits and trips, and the time scrubber", async ({
  page,
  account,
}) => {
  const batch = overlandBatch(account.timezone);
  await uploadedDevice(page, "Commuter", batch);
  const now = Date.now();
  const tracks = tracksResponseSchema.parse(
    await (
      await page.request.get("/api/tracks", {
        params: {
          from: new Date(now - 2 * 86_400_000).toISOString(),
          to: new Date(now + 86_400_000).toISOString(),
        },
      })
    ).json(),
  );
  const [track] = tracks.tracks;
  if (track === undefined) throw new Error("The upload produced no track");
  expect(track.total).toBe(30);
  const kilometres = new Intl.NumberFormat("en-GB", {
    style: "unit",
    unit: "kilometer",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(track.distanceM / 1000);
  expect(track.distanceM).toBeGreaterThan(10_000);

  await page.goto("/history");
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  await expect(summary).toContainText("Commuter");
  await expect(summary).toContainText("30 points");
  await expect(summary).toContainText(kilometres);

  const visits = page.getByRole("region", { name: "Visits", exact: true }).getByRole("listitem");
  await expect(visits).toHaveCount(1);
  // Arrived in the evening, left in the morning: 12 h 40 min 53 s.
  await expect(visits.first()).toContainText("12 hrs 41 mins");
  await expect(visits.first()).toContainText("51.0445° N, 3.7250° E ±35 m");
  const trips = page.getByRole("region", { name: "Trips", exact: true }).getByRole("listitem");
  await expect(trips).toHaveCount(1);
  await expect(trips.first()).toContainText("Bike ride · 14.9 km");
  await expect(trips.first()).toContainText("45 mins");

  // The scrubber starts at the latest point and follows the slider through the day.
  const time = (instant: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: account.timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(Date.parse(instant));
  const points = batch.locations.filter((record) => record.properties["action"] === undefined);
  const first = points.find((record) => record.properties["type"] !== "trip");
  const last = points.filter((record) => record.properties["type"] !== "trip").at(-1);
  const slider = page.getByRole("slider", { name: "Position at" });
  const where = page.locator(".scrubber__where");
  await expect(where).toHaveText(/^50\.9853° N, 3\.5329° E/);
  await expect(page.locator("output")).toHaveText(time(String(last?.properties["timestamp"])));
  await slider.focus();
  await slider.press("Home");
  await expect(where).toHaveText(/^51\.0357° N, 3\.7108° E/);
  await expect(page.locator("output")).toHaveText(time(String(first?.properties["timestamp"])));
  await slider.press("End");
  await expect(where).toHaveText(/^50\.9853° N, 3\.5329° E/);

  // The calendar marks the day once the daily statistics, recomputed about ten seconds
  // after an upload, have caught up.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: account.timezone }).format(now);
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/stats/days", {
          params: { from: today, to: today },
        });
        return daysResponseSchema.parse(await response.json()).days[0]?.points ?? 0;
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe(30);
  await page.reload();
  await page.getByRole("button", { name: /, choose another day$/ }).click();
  await expect(page.getByRole("button", { name: /, today, 30 points$/ })).toBeVisible();
});
