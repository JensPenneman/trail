import { expect, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { localDate, mapView, openMapOptions } from "./support/mapControls";
import { overlandBatch, withBattery } from "./support/overlandBatch";
import { postOverland } from "./support/postOverland";
import { sharingFriend } from "./support/sharingFriend";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

const meCard = (page: Page) => page.getByRole("region", { name: "Me", exact: true });
const personCard = (page: Page, name: string) =>
  page.getByRole("region", { name: "Sharing with you" }).getByRole("article", { name });
const onTheMap = (card: Locator) => card.getByText("On the map", { exact: true });
const ownOnly = ["Timeline", "Visits", "Trips"] as const;
/** One's own day so far, right under the Me card in Live while Me is on the map. */
const myDay = (page: Page) => page.getByRole("region", { name: "Your day so far" });
/** What a card on the map says of where they have been: the part under its heading. */
const whereBeen = (card: Locator) =>
  card
    .locator("div", { has: card.page().getByRole("heading", { name: "Where they’ve been" }) })
    .last();
/** Opens a card's Details: what it holds follows its button. */
async function details(card: Locator): Promise<void> {
  const button = card.getByRole("button", { name: "Details" });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

/** The tracks of people the page asks for: only precise shares with history may be asked. */
function trackRequests(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/api\/v1\/people\/[^/]+\/track$/.test(pathname)) asked.push(pathname);
  });
  return asked;
}

test("a person's card shows them alone, with only what their share allows", async ({
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

  // Home: Me first, a person on the map with their day so far, then everyone who shares, as people.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(onTheMap(meCard(page))).toBeVisible();
  // The fixture's phone is on a bike ride at 18 km/h, 90 seconds ago.
  await expect(meCard(page).getByText(/18\skm\/h$/)).toBeVisible();
  await expect(meCard(page).getByText("Live", { exact: true })).toBeVisible();
  await expect(myDay(page).getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("article", { name: "My phone" })).toHaveCount(0);
  const historianCard = personCard(page, historian.account.displayName);
  const roughCard = personCard(page, rough.account.displayName);
  await expect(historianCard.getByText(/18\skm\/h$/)).toBeVisible();
  // Their devices and the terms of their share are in Details, closed at first.
  await expect(historianCard.getByText(historian.device.name)).toHaveCount(0);
  await details(historianCard);
  await expect(historianCard.getByText(historian.device.name)).toBeVisible();
  await expect(historianCard.getByText("Last 7 days")).toBeVisible();
  await details(roughCard);
  await expect(roughCard.getByText("Approximate location, within about 500 m")).toBeVisible();
  await expect(onTheMap(historianCard)).toHaveCount(0);
  await expect(onTheMap(roughCard)).toHaveCount(0);
  await expect(page.locator(".map-person")).toHaveCount(0);
  await expectAccessible(page, "People with two people who share");
  if (testInfo.project.name === "desktop") {
    // Beside the map only the panel scrolls, never the page itself.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(0);
  }

  // Someone who shares roughly and live only, alone: where they are, nothing of one's own.
  await roughCard.getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(new RegExp(`/\\?people=${rough.account.id}$`));
  await expect(onTheMap(roughCard)).toBeVisible();
  await expect(onTheMap(meCard(page))).toHaveCount(0);
  await expect(myDay(page)).toHaveCount(0);
  await expect(whereBeen(roughCard)).toContainText("Shares live location only");
  await expect(page.locator(".map-person")).toHaveCount(1);
  await expect(page.locator(".maplibregl-canvas")).toHaveAccessibleName(
    new RegExp(`latest position of ${rough.account.displayName}`),
  );
  await expect(mapView(page, "Heat")).toHaveCount(0);
  await openMapOptions(page);
  await expect(page.getByRole("group", { name: "Map style" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Detail of the tracks" })).toHaveCount(0);
  await expectAccessible(page, "Live with someone else alone");

  await mapView(page, "History").click();
  await expect(page).toHaveURL(/[?&]view=history/);
  await expect(whereBeen(roughCard)).toContainText("Shares live location only");
  for (const name of ["Summary", ...ownOnly]) {
    await expect(page.getByRole("region", { name, exact: true }), name).toHaveCount(0);
  }
  await expectAccessible(page, "History of someone who shares none");

  // Someone who shares their history, alone: their track, still nothing of one's own.
  await historianCard.getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("view") === "history" &&
      url.searchParams.get("people") === historian.account.id,
  );
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  await expect(summary).toContainText(
    `${historian.account.displayName} · ${historian.device.name}`,
  );
  await expect(page.getByRole("slider", { name: "Position at" })).toBeVisible();
  // Their card says where they have been today, and steps through the days.
  const theirDay = whereBeen(historianCard);
  await expect(theirDay.getByText("Today", { exact: true })).toBeVisible();
  await expect(theirDay).toContainText(/\d+(\.\d)? km · \d\d:\d\d – \d\d:\d\d/);
  await expect(theirDay.getByRole("button", { name: "Next day" })).toBeDisabled();
  for (const name of ownOnly) {
    await expect(page.getByRole("region", { name, exact: true }), name).toHaveCount(0);
  }
  await expect(page.getByRole("group", { name: "Detail of the tracks" })).toHaveCount(0);
  await expectAccessible(page, "History of someone who shares it");
  expect(new Set(asked)).toEqual(new Set([`/api/v1/people/${historian.account.id}/track`]));
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
  await theirDay.getByRole("button", { name: "Next day" }).click();
  await expect(theirDay.getByText("Today", { exact: true })).toBeVisible();

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
  await expect(whereBeen(historianCard)).toContainText("Shares live location only");
  await expect(summary).toHaveCount(0);
  expect(asked).toEqual([]);

  // Me again: one's own tracks, timeline, visits, trips, levels and heatmap are back.
  await meCard(page).getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(/\/\?view=history$/);
  await expect(onTheMap(meCard(page))).toBeVisible();
  await expect(summary).toContainText("My phone");
  for (const name of ownOnly) {
    await expect(page.getByRole("region", { name, exact: true }), name).toBeVisible();
  }
  await expect(page.getByRole("group", { name: "Detail of the tracks" })).toBeVisible();
  await mapView(page, "Heat").click();
  await expect(page).toHaveURL(/\/\?view=heat$/);
  await expect(
    page.getByRole("region", { name: "Busiest places in view" }).getByRole("listitem").first(),
  ).toContainText(/\d+ points/);
  await expectAccessible(page, "Heat on the People page");
});

test("everyone at once, a card kept live, and sharing back and stopping from it", async ({
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

  await page.goto("/");
  const nearCard = personCard(page, nearName);
  const farCard = personCard(page, far.account.displayName);
  // A battery glyph where the share includes it.
  await expect(nearCard.getByText("77%")).toBeVisible();
  // An area share: no speed is shared, only roughly where.
  await expect(farCard.getByText(/^(On a bike ride|Cycling)$/)).toBeVisible();
  await details(farCard);
  await expect(farCard.getByText("Area only, within about 5 km")).toBeVisible();
  await expect(page.getByText("Live updates on")).toBeAttached();

  // Everyone at once, and Me alone again.
  const everyone = page.getByRole("button", { name: "Show everyone" });
  await expect(everyone).toHaveAttribute("aria-pressed", "false");
  await everyone.click();
  await expect(everyone).toHaveAttribute("aria-pressed", "true");
  await expect(onTheMap(nearCard)).toBeVisible();
  await expect(onTheMap(farCard)).toBeVisible();
  await expect(onTheMap(meCard(page))).toBeVisible();
  await expect(page.locator(".map-person")).toHaveCount(2);
  const shown = new URL(page.url()).searchParams.get("people")?.split(",") ?? [];
  expect(new Set(shown)).toEqual(new Set(["me", near.account.id, far.account.id]));
  await expectAccessible(page, "Live with everyone on the map");

  // Their next upload reaches their card while the page stays open.
  await page.evaluate(() => Reflect.set(window, "trailE2eSamePage", true));
  const next = await postOverland(
    request,
    near.device.token,
    withBattery(overlandBatch(near.account.timezone), 0.42),
  );
  expect(next.status()).toBe(200);
  await expect(nearCard.getByText("42%")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "trailE2eSamePage"))).toBe(true);
  await everyone.click();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");

  // Share back from their card's Details, and stop again from it.
  await details(nearCard);
  await nearCard.getByRole("button", { name: `Share back with ${nearName}` }).click();
  const dialog = page.getByRole("dialog", { name: "Share my location" });
  await expect(dialog.getByLabel("Email address")).toHaveValue(near.account.email);
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await page
    .getByRole("dialog", { name: `Sharing with ${nearName}` })
    .getByRole("button", { name: "Done" })
    .click();
  await expect(nearCard.getByText(`You share with ${nearName}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /^You share with 1 person/ })).toBeVisible();
  await nearCard
    .getByRole("button", { name: `Stop sharing your location with ${nearName}` })
    .click();
  const stop = page.getByRole("dialog", { name: `Stop sharing with ${nearName}?` });
  await expectAccessible(page, "the stop-sharing dialog");
  await stop.getByRole("button", { name: "Stop sharing" }).click();
  await expect(nearCard.getByRole("button", { name: `Share back with ${nearName}` })).toBeVisible();
  await expect(page.getByRole("link", { name: /^You share with nobody/ })).toBeVisible();

  // A link to someone alone (the old People page's Show on map) shows them alone.
  await page.goto(`/?view=live&people=${far.account.id}`);
  await expect(onTheMap(farCard)).toBeVisible();
  await expect(myDay(page)).toHaveCount(0);
  await expect(page.locator(".map-person")).toHaveCount(1);
  await expect(page.locator(".maplibregl-canvas")).toHaveAccessibleName(
    new RegExp(`latest position of ${far.account.displayName}`),
  );
  // Shown already: Show on map moves the camera and keeps the choice.
  await farCard.getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(new RegExp(`/\\?view=live&people=${far.account.id}$`));
  await expect(onTheMap(farCard)).toBeVisible();
});
