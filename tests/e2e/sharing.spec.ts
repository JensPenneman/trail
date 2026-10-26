import { expect, type Page } from "@playwright/test";
import { fact } from "./support/deviceCard";
import { expectAccessible } from "./support/expectAccessible";
import { type OverlandBatch, overlandBatch } from "./support/overlandBatch";
import { postOverland } from "./support/postOverland";
import { signUp } from "./support/signUp";
import { test } from "./support/test";
import { uniqueEmail } from "./support/uniqueEmail";
import { uploadedDevice } from "./support/uploadedDevice";

/** The same upload with every battery reading changed: what the phone sends a little later. */
function withBattery(batch: OverlandBatch, level: number): OverlandBatch {
  const charged = (feature: OverlandBatch["locations"][number]) => ({
    ...feature,
    properties: { ...feature.properties, battery_level: level },
  });
  return {
    ...batch,
    locations: batch.locations.map(charged),
    ...(batch.current === undefined ? {} : { current: charged(batch.current) }),
  };
}

const youShareWith = (page: Page) => page.getByRole("region", { name: "You share with" });

test("someone you share with sees you live, may hide you, and loses you when you stop", async ({
  page,
  account,
  openBrowser,
  request,
}) => {
  const phone = await uploadedDevice(page, "Sharer’s phone", overlandBatch(account.timezone));
  const friend = await openBrowser();
  const friendEmail = uniqueEmail("friend");
  const friendAccount = await signUp(friend.page, friendEmail);

  await page.goto("/people");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await page.getByRole("button", { name: "Share my location" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Share my location" });
  await dialog.getByLabel("Email address").fill(friendEmail);
  await expect(dialog.getByRole("radio", { name: /^Precise/ })).toBeChecked();
  await expectAccessible(page, "the share dialog");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  const shared = page.getByRole("dialog", { name: `Sharing with ${friendAccount.displayName}` });
  await expect(
    shared.getByText(`${friendAccount.displayName} can see your location now`),
  ).toBeVisible();
  await shared.getByRole("button", { name: "Done" }).click();
  await expect(youShareWith(page).getByText("Sees you")).toBeVisible();

  await friend.page.goto("/people");
  const card = friend.page.getByRole("article", { name: account.displayName });
  await expect(card.getByText("Sharer’s phone")).toBeVisible();
  await expect(fact(card, "Battery")).toContainText("77%");
  await expectAccessible(friend.page, "People with someone who shares");
  await expect(friend.page.getByText("Live updates on")).toBeAttached();
  // Survives only if the page is not reloaded.
  await friend.page.evaluate(() => Reflect.set(window, "trailE2eSamePage", true));

  const later = await postOverland(
    request,
    phone.token,
    withBattery(overlandBatch(account.timezone), 0.42),
  );
  expect(later.status()).toBe(200);
  await expect(fact(card, "Battery")).toContainText("42%");
  expect(await friend.page.evaluate(() => Reflect.get(window, "trailE2eSamePage"))).toBe(true);

  await card.getByRole("button", { name: `Hide ${account.displayName}` }).click();
  await expect(card).toBeHidden();
  await expect(friend.page.getByText("Hidden (1)")).toBeVisible();
  // The sharer sees it at once, through their own live stream.
  await expect(youShareWith(page).getByText("Hid you")).toBeVisible();
  await friend.page.getByText("Hidden (1)").click();
  await friend.page.getByRole("button", { name: `Show ${account.displayName} again` }).click();
  await expect(card).toBeVisible();

  await youShareWith(page)
    .getByRole("button", { name: `Stop sharing with ${friendAccount.displayName}` })
    .click();
  await page
    .getByRole("dialog", { name: `Stop sharing with ${friendAccount.displayName}?` })
    .getByRole("button", { name: "Stop sharing" })
    .click();
  await expect(card).toBeHidden();
  await expect(friend.page.getByText("Nobody shares with you yet")).toBeVisible();
  expect(await friend.page.evaluate(() => Reflect.get(window, "trailE2eSamePage"))).toBe(true);
  await friend.page.reload();
  await expect(friend.page.getByText("Nobody shares with you yet")).toBeVisible();
  await expect(
    youShareWith(page).getByText("Nobody sees your location.", { exact: false }),
  ).toBeVisible();
});

test("a public link shows your location without an account until it is turned off or ends", async ({
  page,
  account,
  openBrowser,
  consoleGuard,
}) => {
  await uploadedDevice(page, "Linked phone", overlandBatch(account.timezone));
  await page.goto("/settings");
  const sharing = page.getByRole("region", { name: "Sharing", exact: true });
  await sharing.getByLabel("Label (optional)").fill("On my way");
  await sharing.getByRole("button", { name: "Make link" }).click();
  const link = await sharing.getByRole("textbox", { name: "Public link" }).inputValue();
  // The secret is the fragment: browsers never send it to a server, a proxy or as a referrer.
  expect(link).toMatch(/\/s#trls_[A-Za-z0-9_-]{43}$/);
  const secret = new URL(link).hash.slice(1);
  await expect(
    sharing.getByRole("img", { name: "Code with the public link to your location" }),
  ).toBeVisible();

  const visitor = await openBrowser();
  const asked: string[] = [];
  visitor.page.on("request", (sent) => asked.push(sent.url()));
  const opened = await visitor.page.goto(link);
  expect(opened?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(opened?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(visitor.page.getByRole("heading", { level: 1, name: "On my way" })).toBeVisible();
  await expect(visitor.page.getByText("Linked phone")).toBeVisible();
  await expect(visitor.page.getByText(/^This link expires /)).toBeVisible();
  await expect(visitor.page.getByRole("navigation")).toHaveCount(0);
  await expectAccessible(visitor.page, "a public link");
  expect(asked.map((url) => new URL(url).pathname)).not.toContain("/api/auth/session");
  expect(asked.some((url) => url.includes(secret))).toBe(false);

  consoleGuard.expectFailedResponse(404, /\/api\/public\/share$/);
  await sharing.getByRole("button", { name: "Turn off the link “On my way”" }).click();
  await expect(sharing.getByText("On my way")).toBeHidden();
  await visitor.page.reload();
  await expect(
    visitor.page.getByRole("heading", { level: 2, name: "This link has ended" }),
  ).toBeVisible();
  await expectAccessible(visitor.page, "a link that has ended");

  // A link runs an hour at least, so none ends while this test waits: an expired link answers
  // like a turned-off one (`share_expired`, covered by the API's integration tests).
  const brief = await page.request.post("/api/v1/share-links", {
    data: { precision: "area", expiresAt: new Date(Date.now() + 3000).toISOString() },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(brief.status()).toBe(400);
  expect(await brief.json()).toMatchObject({
    error: { code: "validation_failed", fields: { expiresAt: [expect.any(String)] } },
  });

  await visitor.page.goto(`/s#trls_${"A".repeat(43)}`);
  await expect(
    visitor.page.getByRole("heading", { level: 2, name: "This link does not work" }),
  ).toBeVisible();
});
