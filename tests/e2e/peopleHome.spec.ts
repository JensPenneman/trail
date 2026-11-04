import { expect, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { localDate, mapView, openMapOptions } from "./support/mapControls";
import { overlandBatch, withBattery } from "./support/overlandBatch";
import { postOverland } from "./support/postOverland";
import { sharingFriend } from "./support/sharingFriend";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

const peopleList = (page: Page) => page.getByRole("list", { name: "People", exact: true });
const meRow = (page: Page) => peopleList(page).getByRole("link", { name: /^Me(\s|$)/ });
/** The row of someone: the name, then a space or the end, so a longer name does not match. */
const personRow = (page: Page, name: string) =>
  peopleList(page).getByRole("link", {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`),
  });
/** A person's detail replaces the list; the region is named by their name. */
const detail = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const ownOnly = ["Timeline", "Visits", "Trips"] as const;
/** One's own day so far, in Me's detail in Live. */
const myDay = (page: Page) => page.getByRole("region", { name: "Your day so far" });
/** What a detail says of where the person has been: the part under its heading. */
const whereBeen = (view: Locator) =>
  view
    .locator("div", { has: view.page().getByRole("heading", { name: "Where they’ve been" }) })
    .last();
const backToList = (page: Page) => page.getByRole("link", { name: "Back to People" });

/** The tracks of people the page asks for: only precise shares with history may be asked. */
function trackRequests(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/api\/v1\/people\/[^/]+\/track$/.test(pathname)) asked.push(pathname);
  });
  return asked;
}

test("a person's detail shows them alone, with only what their share allows", async ({
  page,
  account,
  openBrowser,
}, testInfo) => {
  // Three people, each with a browser and a phone of their own.
  test.slow();
  await uploadedDevice(page, "My phone", overlandBatch(account.timezone));
  const historian = await sharingFriend(openBrowser, account, "historian", {
    precision: "precise",
    historyDays: 7,
  });
  const rough = await sharingFriend(openBrowser, account, "rough", {
    precision: "approximate",
    historyDays: null,
  });
  const asked = trackRequests(page);
  const historianName = historian.account.displayName;
  const roughName = rough.account.displayName;

  // Home: the list, Me first, then everyone who shares, as people. Nobody is selected, so the
  // map shows where everyone is and nothing is asked of anyone's track.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  // The fixture's phone is on a bike ride at 18 km/h, 90 seconds ago.
  await expect(meRow(page).getByText(/18\skm\/h$/)).toBeVisible();
  await expect(meRow(page).getByText("Live", { exact: true })).toBeVisible();
  await expect(peopleList(page).getByRole("link")).toHaveCount(3);
  await expect(personRow(page, historianName).getByText(/18\skm\/h$/)).toBeVisible();
  await expect(page.getByText(historian.device.name)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "My phone" })).toHaveCount(0);
  await expect(myDay(page)).toHaveCount(0);
  await expect(page.locator(".maplibregl-canvas")).toHaveAccessibleName(
    /^Map of where everyone is now/,
  );
  await expect(page.locator(".map-person")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Share my location" })).toBeVisible();
  await expectAccessible(page, "People's list with two people who share");
  if (testInfo.project.name === "desktop") {
    // Beside the map only the panel scrolls, never the page itself.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(0);
  }
  expect(asked).toEqual([]);

  // Someone who shares roughly and live only: where they are, nothing of one's own.
  await personRow(page, roughName).click();
  await expect(page).toHaveURL(new RegExp(`/\\?person=${rough.account.id}$`));
  await expect(page.getByRole("heading", { level: 2, name: roughName })).toBeFocused();
  await expect(peopleList(page)).toHaveCount(0);
  await expect(myDay(page)).toHaveCount(0);
  await expect(whereBeen(detail(page, roughName))).toContainText("Shares live location only");
  // Their devices and the terms of their share are right in the detail.
  await expect(detail(page, roughName).getByText(rough.device.name)).toBeVisible();
  await expect(
    detail(page, roughName).getByText("Approximate location, within about 500 m"),
  ).toBeVisible();
  // Everyone's markers stay on the map; the camera and the label follow the person.
  await expect(page.locator(".map-person")).toHaveCount(2);
  await expect(page.locator(".maplibregl-canvas")).toHaveAccessibleName(
    /^Map of where everyone is now/,
  );
  await expect(mapView(page, "Heat")).toHaveCount(0);
  await openMapOptions(page);
  await expect(page.getByRole("group", { name: "Map style" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Detail of the tracks" })).toHaveCount(0);
  await expectAccessible(page, "Live with someone else selected");

  await mapView(page, "History").click();
  await expect(page).toHaveURL(/[?&]view=history/);
  await expect(whereBeen(detail(page, roughName))).toContainText("Shares live location only");
  for (const name of ["Summary", ...ownOnly]) {
    await expect(page.getByRole("region", { name, exact: true }), name).toHaveCount(0);
  }
  await expectAccessible(page, "History of someone who shares none");

  // Back to the list: the focus returns to the row. History's overview draws everyone who shares
  // history: their track and one's own, but not one's own timeline, visits and trips.
  await backToList(page).click();
  await expect(personRow(page, roughName)).toBeFocused();
  await expect(page).toHaveURL(/\/\?view=history$/);
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary).toContainText(`${historianName} · ${historian.device.name}`);
  await expect(summary).toContainText("My phone");
  for (const name of ownOnly) {
    await expect(page.getByRole("region", { name, exact: true }), name).toHaveCount(0);
  }
  await expect(page.getByRole("slider", { name: "Position at" })).toBeVisible();
  expect(new Set(asked)).toEqual(new Set([`/api/v1/people/${historian.account.id}/track`]));
  await expectAccessible(page, "History's overview");

  // Someone who shares their history, alone: their track, still nothing of one's own.
  await personRow(page, historianName).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("view") === "history" &&
      url.searchParams.get("person") === historian.account.id,
  );
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  await expect(summary).toContainText(`${historianName} · ${historian.device.name}`);
  await expect(summary).not.toContainText("My phone");
  await expect(page.getByRole("slider", { name: "Position at" })).toBeVisible();
  // Their detail says where they have been today, and steps through the days.
  const theirDay = whereBeen(detail(page, historianName));
  await expect(theirDay.getByText("Today", { exact: true })).toBeVisible();
  await expect(theirDay).toContainText(/\d+(\.\d)? km · \d\d:\d\d – \d\d:\d\d/);
  await expect(theirDay.getByRole("button", { name: "Next day" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  for (const name of ownOnly) {
    await expect(page.getByRole("region", { name, exact: true }), name).toHaveCount(0);
  }
  await expect(page.getByRole("group", { name: "Detail of the tracks" })).toHaveCount(0);
  await expectAccessible(page, "History of someone who shares it");
  // Live has their day too; a day back is History's.
  await mapView(page, "Live").click();
  await expect(theirDay.getByText("Today", { exact: true })).toBeVisible();
  await theirDay.getByRole("button", { name: "Previous day" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("view") === "history" &&
      url.searchParams.get("date") === localDate(account.timezone, -1),
  );
  await expect(theirDay).toContainText("Nothing recorded on");
  // Today's track is asked for again (none is kept off screen): its answer is in before the
  // share changes, so that request is not taken for one made after the change.
  const todaysTrack = page.waitForResponse((response) =>
    /^\/api\/v1\/people\/[^/]+\/track$/.test(new URL(response.url()).pathname),
  );
  await theirDay.getByRole("button", { name: "Next day" }).click();
  await todaysTrack;
  await expect(theirDay.getByText("Today", { exact: true })).toBeVisible();
  await expect(theirDay).toContainText(/\d+(\.\d)? km · \d\d:\d\d – \d\d:\d\d/);

  // Approximate and live only from now on: the page stops asking for their history.
  asked.length = 0;
  const changed = await historian.browser.page.request.patch(
    `/api/v1/shares/${historian.share.id}`,
    {
      data: { precision: "approximate", historyDays: null },
      headers: { Origin: historian.origin },
    },
  );
  expect(changed.status()).toBe(200);
  await expect(whereBeen(detail(page, historianName))).toContainText("Shares live location only");
  await expect(summary).toHaveCount(0);
  expect(asked).toEqual([]);

  // Me: one's own tracks, timeline, visits, trips, levels and heatmap are there.
  await backToList(page).click();
  await meRow(page).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("person") === "me");
  await expect(detail(page, "Me")).toBeVisible();
  await expect(summary).toContainText("My phone");
  for (const name of ownOnly) {
    await expect(page.getByRole("region", { name, exact: true }), name).toBeVisible();
  }
  await expect(page.getByRole("group", { name: "Detail of the tracks" })).toBeVisible();
  // Always: the devices, in the detail and not behind a button.
  await expect(detail(page, "Me").getByRole("link", { name: "My phone" })).toBeVisible();
  await expectAccessible(page, "History in Me's detail");
  await mapView(page, "Live").click();
  await expect(myDay(page).getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expectAccessible(page, "Live in Me's detail");
  await mapView(page, "Heat").click();
  await expect(page).toHaveURL(/[?&]view=heat/);
  await expect(
    page.getByRole("region", { name: "Busiest places in view" }).getByRole("listitem").first(),
  ).toContainText(/\d+ points/);
  await expectAccessible(page, "Heat on the People page");
});

test("the list kept live, and sharing back and stopping from a detail", async ({
  page,
  account,
  openBrowser,
  request,
}) => {
  // Three people, each with a browser and a phone of their own.
  test.slow();
  await uploadedDevice(page, "My phone", overlandBatch(account.timezone));
  const near = await sharingFriend(openBrowser, account, "near", {
    precision: "precise",
    historyDays: null,
  });
  const far = await sharingFriend(openBrowser, account, "far", {
    precision: "area",
    historyDays: null,
  });
  const nearName = near.account.displayName;
  const farName = far.account.displayName;

  await page.goto("/");
  const nearRow = personRow(page, nearName);
  const farRow = personRow(page, farName);
  // A battery glyph where the share includes it.
  await expect(nearRow.getByRole("img", { name: "Battery 77%" })).toBeVisible();
  // An area share: no speed is shared, only roughly where.
  // Always how roughly, and a distance that says it is about that much.
  await expect(
    farRow.getByText(/^(On\sa\sbike\sride|Cycling)\s·\swithin\sabout\s5\skm$/),
  ).toBeVisible();
  await expect(farRow.getByText(/km$/).first()).toContainText("≈");
  await expect(page.getByText("Live updates on")).toBeAttached();
  await farRow.click();
  await expect(detail(page, farName).getByText("Area only, within about 5 km")).toBeVisible();
  await backToList(page).click();

  // Their next upload reaches their row while the page stays open.
  await page.evaluate(() => Reflect.set(window, "trailE2eSamePage", true));
  const next = await postOverland(
    request,
    near.device.token,
    withBattery(overlandBatch(near.account.timezone), 0.42),
  );
  expect(next.status()).toBe(200);
  await expect(nearRow.getByRole("img", { name: "Battery 42%" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "trailE2eSamePage"))).toBe(true);

  // Share back from their detail, and stop again from it.
  await nearRow.click();
  const nearDetail = detail(page, nearName);
  await nearDetail.getByRole("button", { name: `Share back with ${nearName}` }).click();
  const dialog = page.getByRole("dialog", { name: "Share my location" });
  await expect(dialog.getByLabel("Email address")).toHaveValue(near.account.email);
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await page
    .getByRole("dialog", { name: `Sharing with ${nearName}` })
    .getByRole("button", { name: "Done" })
    .click();
  await expect(nearDetail.getByText(`You share with ${nearName}`)).toBeVisible();
  await expectAccessible(page, "a person's detail");
  await nearDetail
    .getByRole("button", { name: `Stop sharing your location with ${nearName}` })
    .click();
  const stop = page.getByRole("dialog", { name: `Stop sharing with ${nearName}?` });
  await expectAccessible(page, "the stop-sharing dialog");
  await stop.getByRole("button", { name: "Stop sharing" }).click();
  await expect(
    nearDetail.getByRole("button", { name: `Share back with ${nearName}` }),
  ).toBeVisible();

  // The quiet line under the list says whom one shares with, and leads to Settings › Sharing.
  await backToList(page).click();
  await expect(page.getByRole("link", { name: /^You share with nobody/ })).toBeVisible();

  // A link from before the single selection (the old People page's Show on map) selects them.
  await page.goto(`/?view=live&people=${far.account.id}`);
  await expect(detail(page, farName)).toBeVisible();
  await expect(myDay(page)).toHaveCount(0);
  await expect(page.locator(".map-person")).toHaveCount(2);
  await expect(page.locator(".maplibregl-canvas")).toHaveAccessibleName(
    /^Map of where everyone is now/,
  );
  // The focus stays where the page put it: nothing moves for a link that opens a detail.
  await expect(page.getByRole("heading", { level: 2, name: farName })).not.toBeFocused();
});
