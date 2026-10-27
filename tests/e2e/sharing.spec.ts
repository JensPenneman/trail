import { expect, type Page } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { overlandBatch, withBattery } from "./support/overlandBatch";
import { postOverland } from "./support/postOverland";
import { signUp } from "./support/signUp";
import { test } from "./support/test";
import { uniqueEmail } from "./support/uniqueEmail";
import { uploadedDevice } from "./support/uploadedDevice";

/** Whom one shares with, with what they see: Settings › Sharing (People links there). */
const youShareWith = (page: Page) => page.getByRole("region", { name: "Sharing", exact: true });

test("someone you share with sees you live, may hide you, and loses you when you stop", async ({
  page,
  account,
  openBrowser,
  request,
}) => {
  // Two people with a browser each, through sharing, hiding and stopping: a long walk.
  test.slow();
  const phone = await uploadedDevice(page, "Sharer’s phone", overlandBatch(account.timezone));
  const friend = await openBrowser();
  const friendEmail = uniqueEmail("friend");
  const friendAccount = await signUp(friend.page, friendEmail);

  // Share my location, from the home page.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await page.getByRole("button", { name: "Share my location" }).click();
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
  // The line under the people says so, and leads to the list in Settings.
  await page.getByRole("link", { name: /^You share with 1 person/ }).click();
  await expect(page).toHaveURL(/\/settings\/sharing$/);
  await expect(youShareWith(page).getByText("Sees you")).toBeVisible();

  await friend.page.goto("/");
  const card = friend.page.getByRole("article", { name: account.displayName });
  // Who and how fresh at a glance, with the battery; the phone itself in Details.
  await expect(card.getByText("77%")).toBeVisible();
  await card.getByRole("button", { name: "Details" }).click();
  await expect(card.getByText("Sharer’s phone")).toBeVisible();
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
  await expect(card.getByText("42%").first()).toBeVisible();
  expect(await friend.page.evaluate(() => Reflect.get(window, "trailE2eSamePage"))).toBe(true);

  await card.getByRole("button", { name: `Hide ${account.displayName}` }).click();
  await expect(card).toBeHidden();
  await expect(friend.page.getByText("Hidden (1)")).toBeVisible();
  // The sharer sees it at once, through their own live stream.
  await expect(youShareWith(page).getByText("Hid you")).toBeVisible();
  await friend.page.getByText("Hidden (1)").click();
  await friend.page.getByRole("button", { name: `Show ${account.displayName} again` }).click();
  await expect(card).toBeVisible();

  // Each person has a page of their own in Settings › Sharing; stopping is there.
  await youShareWith(page).getByRole("link", { name: friendAccount.displayName }).click();
  const sharePage = page.getByRole("region", { name: friendAccount.displayName, exact: true });
  await expect(sharePage.getByText("Sees you")).toBeVisible();
  await sharePage.getByRole("button", { name: "Stop sharing" }).click();
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
  await page.goto("/settings/links");
  await page.getByRole("button", { name: "Make a public link" }).click();
  const form = page.getByRole("dialog", { name: "Make a public link" });
  await form.getByLabel("Label (optional)").fill("On my way");
  await form.getByRole("button", { name: "Make link" }).click();
  // The link's page shows its address and code, this once.
  const linkPage = page.getByRole("region", { name: "On my way", exact: true });
  await expect(page).toHaveURL(/\/settings\/links\/[0-9a-f-]{36}$/);
  const link = await linkPage.getByRole("textbox", { name: "Public link" }).inputValue();
  // The secret is the fragment: browsers never send it to a server, a proxy or as a referrer.
  expect(link).toMatch(/\/s#trls_[A-Za-z0-9_-]{43}$/);
  const secret = new URL(link).hash.slice(1);
  await expect(
    linkPage.getByRole("img", { name: "Code with the public link to your location" }),
  ).toBeVisible();
  await expectAccessible(page, "a new public link's page");

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
  await linkPage.getByRole("button", { name: "Turn off link" }).click();
  await page
    .getByRole("dialog", { name: "Turn off “On my way”?" })
    .getByRole("button", { name: "Turn off" })
    .click();
  // Back on the list, which no longer has it.
  await expect(page).toHaveURL(/\/settings\/links$/);
  await expect(page.getByText("No links yet.")).toBeVisible();
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
