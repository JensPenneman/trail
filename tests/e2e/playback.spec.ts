import { expect } from "@playwright/test";
import { daysResponseSchema } from "@trail/contracts/stats";
import { expectAccessible } from "./support/expectAccessible";
import { localDate } from "./support/mapControls";
import { postOverland } from "./support/postOverland";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";
import { walkAndDrive } from "./support/walkAndDrive";

/** The instant of `time` on the local `date` in `timeZone`, in epoch milliseconds. */
function localInstant(date: string, time: string, timeZone: string): number {
  const wanted = Date.parse(`${date}T${time}Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const shown = (instant: number) => {
    const map = Object.fromEntries(parts.formatToParts(instant).map((p) => [p.type, p.value]));
    return Date.parse(
      `${map["year"]}-${map["month"]}-${map["day"]}T${map["hour"]}:${map["minute"]}:${map["second"]}Z`,
    );
  };
  let guess = wanted;
  for (let round = 0; round < 3; round++) guess += wanted - shown(guess);
  return guess;
}

const dayLong = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(Date.parse(`${date}T12:00:00Z`));

/** One walk and drive three days ago ending 10:00 and one yesterday ending 15:00, nothing between. */
async function seededDays(page: import("@playwright/test").Page, timeZone: string) {
  const first = localDate(timeZone, -3);
  const empty = localDate(timeZone, -2);
  const last = localDate(timeZone, -1);
  const device = await uploadedDevice(
    page,
    "Player phone",
    walkAndDrive(localInstant(first, "10:00:30", timeZone), 0),
  );
  const response = await postOverland(
    page.request,
    device.token,
    walkAndDrive(localInstant(last, "15:00:30", timeZone), 0),
  );
  expect(response.status()).toBe(200);
  await expect
    .poll(
      async () => {
        const days = daysResponseSchema.parse(
          await (
            await page.request.get("/api/stats/days", { params: { from: first, to: last } })
          ).json(),
        ).days;
        return [first, last].every((date) => days.some((d) => d.date === date && d.points > 0));
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true);
  return { first, empty, last };
}

test("History plays from midnight to the last point, skipping the empty day", async ({
  page,
  account,
}) => {
  test.slow();
  const timeZone = account.timezone;
  const { first, empty, last } = await seededDays(page, timeZone);
  const emptyFrom = localInstant(empty, "00:00:00", timeZone);
  const emptyTo = localInstant(empty, "23:59:59", timeZone);
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== "/api/tracks") return;
    const from = Date.parse(url.searchParams.get("from") ?? "");
    if (from >= emptyFrom && from <= emptyTo) asked.push(request.url());
  });

  await page.goto(`/?view=history&person=me&date=${first}&at=${first}T00:00`);
  await expect(page.locator("output")).toHaveText("00:00");
  await page.locator("[data-play]").click();
  const bar = page.getByRole("region", { name: "Playback" });
  await expect(bar).toBeVisible();
  await expect(page.getByRole("region", { name: "At this moment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeFocused();

  // Nothing is written to the address while it plays.
  await page.waitForTimeout(1_000);
  expect(new URL(page.url()).searchParams.get("at")).toBe(`${first}T00:00`);
  expect(new URL(page.url()).searchParams.get("date")).toBe(first);

  // Paused: the moment is in the address, and the page is accessible.
  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("at")).not.toBe(`${first}T00:00`);
  await expectAccessible(page, "playback paused");

  // The fastest speed, stops skipped (set while paused: at 1 h/s the day is over in seconds).
  await bar.getByRole("radio", { name: "1 h/s" }).check();
  await bar.getByRole("switch", { name: "Skip stops" }).setChecked(true);

  // Resumed: yesterday is announced, the empty day between asks for no tracks.
  await bar.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: dayLong(last) })
      .first(),
  ).toBeAttached({
    timeout: 90_000,
  });
  await expect(bar.getByRole("slider", { name: "Position at" })).toHaveAttribute(
    "aria-valuetext",
    new RegExp(`^${dayLong(last)}`),
    { timeout: 90_000 },
  );
  await expect(bar.locator(".player-bar__readout")).toHaveText(/15:00$/, { timeout: 90_000 });
  await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(asked).toEqual([]);

  // The end: the address holds yesterday and the last point.
  await expect.poll(() => new URL(page.url()).searchParams.get("date")).toBe(last);
  expect(new URL(page.url()).searchParams.get("at")).toBe(`${last}T15:00`);
  await expectAccessible(page, "playback ended");

  // Escape leaves, and the slider's Play has the focus.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Me", exact: true })).toBeVisible();
  await expect(page.locator("[data-play]")).toBeFocused();
});

test("with reduced motion the clock moves in whole hours", async ({ page, account }) => {
  test.slow();
  const timeZone = account.timezone;
  const { first } = await seededDays(page, timeZone);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?view=history&person=me&date=${first}&at=${first}T00:00`);
  await page.locator("[data-play]").click();
  const bar = page.getByRole("region", { name: "Playback" });
  await bar.getByRole("radio", { name: "1 h/s" }).check();
  const readout = bar.locator(".player-bar__readout");
  await expect(readout).toHaveText(/(0[1-9]|1\d):00$/, { timeout: 30_000 });
  // Whole hours at every look, a second apart, and the hours move on.
  const hours: string[] = [];
  for (let look = 0; look < 3; look++) {
    const text = (await readout.textContent()) ?? "";
    expect(text, `look ${look}`).toMatch(/\d\d:00$/);
    hours.push(text);
    await page.waitForTimeout(1_000);
  }
  expect(new Set(hours).size).toBeGreaterThan(1);
  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  await expectAccessible(page, "playback paused, reduced motion");
});
