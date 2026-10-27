import { expect } from "@playwright/test";
import { shareResponseSchema } from "@trail/contracts/share";
import { deviceCard } from "./support/deviceCard";
import { expectAccessible } from "./support/expectAccessible";
import { mapView, openMapOptions } from "./support/mapControls";
import { overlandBatch } from "./support/overlandBatch";
import { signUp } from "./support/signUp";
import { test } from "./support/test";
import { uniqueEmail } from "./support/uniqueEmail";
import { uploadedDevice } from "./support/uploadedDevice";

test("people who share appear on the map as far as their shares allow", async ({
  page,
  account,
  openBrowser,
}, testInfo) => {
  await uploadedDevice(page, "My phone", overlandBatch(account.timezone));
  // Someone else, with a phone of their own, shares precisely with a week of history.
  const friend = await openBrowser();
  const friendAccount = await signUp(friend.page, uniqueEmail("friend"));
  await uploadedDevice(friend.page, "Friend’s phone", overlandBatch(friendAccount.timezone));
  const origin = new URL(friend.page.url()).origin;
  const created = await friend.page.request.post("/api/v1/shares", {
    data: { email: account.email, precision: "precise", historyDays: 7, duration: "indefinitely" },
    headers: { Origin: origin },
  });
  expect(created.status()).toBe(201);
  const { share } = shareResponseSchema.parse(await created.json());
  const name = friendAccount.displayName;

  // The map starts with the signed-in person; the friend is one tap away.
  await page.goto("/");
  await openMapOptions(page);
  const people = page.getByRole("group", { name: "People" });
  await expect(people.getByRole("checkbox", { name: "Me" })).toBeChecked();
  await expect(page.locator(".map-person")).toHaveCount(0);
  // Their share includes history: Live draws today's track too.
  const theirTrack = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/people/${friendAccount.id}/track?`),
  );
  await people.getByRole("checkbox", { name }).check();
  await expect(page).toHaveURL(new RegExp(`[?&]people=me%2C${friendAccount.id}$`));
  const card = page.getByRole("article", { name });
  await expect(card.getByText("Friend’s phone")).toBeVisible();
  await expect(page.locator(".map-person")).toHaveCount(1);
  // The device filter lists their phone under their name, beside one's own.
  const devices = page.getByRole("group", { name: "Devices" });
  await expect(devices.getByRole("group", { name })).toBeVisible();
  await expect(devices.getByRole("checkbox", { name: "Friend’s phone" })).toBeChecked();
  await expectAccessible(page, "Live with someone who shares");
  if (testInfo.project.name === "desktop") {
    // Beside the map only the panel scrolls, never the page itself.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(0);
  }

  expect((await theirTrack).status()).toBe(200);

  // History draws it beside one's own.
  await mapView(page, "History").click();
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary.getByRole("listitem")).toHaveCount(2);
  await expect(summary).toContainText(`${name} · Friend’s phone`);
  await expect(summary).toContainText("My phone");

  // Approximate and live only from now on: the page stops asking for their history.
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/people/") && request.url().includes("/track")) {
      asked.push(request.url());
    }
  });
  const changed = await friend.page.request.patch(`/api/v1/shares/${share.id}`, {
    data: { precision: "approximate", historyDays: null },
    headers: { Origin: origin },
  });
  expect(changed.status()).toBe(200);
  await expect(
    page.getByText(`${name} shares where they are now, not where they have been.`),
  ).toBeVisible();
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  await expect(summary).not.toContainText(name);
  await expectAccessible(page, "History with someone who shares no history");
  expect(asked).toEqual([]);

  // People › Show on map: the map with them alone.
  await page.goto("/people");
  await page.getByRole("article", { name }).getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(new RegExp(`/\\?view=live&people=${friendAccount.id}$`));
  await expect(page.getByRole("article", { name })).toBeVisible();
  await expect(deviceCard(page, "My phone")).toHaveCount(0);
  await expect(page.locator(".map-person")).toHaveCount(1);
  await expect(page.locator(".maplibregl-canvas")).toHaveAccessibleName(
    new RegExp(`latest position of ${name}`),
  );
});
