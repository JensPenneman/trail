import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiTokenWithSecretResponseSchema } from "@trail/contracts/apiToken";
import {
  type DataAccessSummary,
  dataAccessLogResponseSchema,
  dataAccessSummarySchema,
} from "@trail/contracts/dataAccess";
import { shareResponseSchema } from "@trail/contracts/share";
import { createShareLinkResponseSchema } from "@trail/contracts/shareLink";
import { expectAccessible } from "./support/expectAccessible";
import { overlandBatch } from "./support/overlandBatch";
import { currentUser, signUp } from "./support/signUp";
import { test } from "./support/test";
import { uniqueEmail } from "./support/uniqueEmail";
import { uploadedDevice } from "./support/uploadedDevice";

/*
 * The pages of the data access log (docs/architecture.md §14) with what the
 * server really recorded: someone you share with reading your track, a
 * public link opened in another browser, a token calling the API and the MCP
 * server, and your own browsing — each written by the recorder two seconds
 * after it happened, which the tests wait for through the API.
 */

const title = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

/** An unsafe request of the signed-in page, from its own origin as the CSRF guard asks. */
const fromPage = (page: Page) => ({ Origin: new URL(page.url()).origin });

/** The owner's summary of the last 30 days, of everyone or of one actor. */
async function summaryOf(page: Page, actorId?: string): Promise<DataAccessSummary> {
  const response = await page.request.get(apiPaths.v1.accessLog.summary, {
    params: actorId === undefined ? {} : { actorId },
  });
  expect(response.status()).toBe(200);
  return dataAccessSummarySchema.parse(await response.json());
}

/** How often each action is in a summary's people, links or tokens. */
const countOf = (actions: readonly { action: string; count: number }[], names: string[]) =>
  actions
    .filter((entry) => names.includes(entry.action))
    .reduce((sum, entry) => sum + entry.count, 0);

const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);

/** 14:05 in the account's zone, as the pages write a time. */
const clock = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    Date.parse(instant),
  );

/** One JSON-RPC message to /mcp, as a 2025-era MCP client sends it. */
async function mcp(request: APIRequestContext, secret: string, message: object) {
  const response = await request.post(apiPaths.mcp, {
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    data: message,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { result?: Record<string, unknown> };
}

/** A token of the owner's, made through the API (the token dialog has specs of its own). */
async function tokenOf(page: Page, name: string) {
  const response = await page.request.post(apiPaths.me.tokens, {
    headers: fromPage(page),
    data: {
      name,
      scopes: ["profile:read", "devices:read", "history:read"],
      expiresAt: null,
    },
  });
  expect(response.status()).toBe(201);
  return apiTokenWithSecretResponseSchema.parse(await response.json());
}

test("someone you share with who reads your track is under People, with what they looked at", async ({
  page,
  account,
  openBrowser,
}) => {
  // Two people, each with a browser of their own.
  test.slow();
  const phone = await uploadedDevice(page, "Looked-at phone", overlandBatch(account.timezone));
  const friend = await openBrowser();
  const friendAccount = await signUp(friend.page, uniqueEmail("viewer"));
  const shared = await page.request.post(apiPaths.v1.shares.root, {
    headers: fromPage(page),
    data: {
      email: friendAccount.email,
      precision: "precise",
      historyDays: 7,
      duration: "indefinitely",
    },
  });
  expect(shared.status()).toBe(201);
  const share = shareResponseSchema.parse(await shared.json()).share;

  // They open your history on their People page: a look at you and at your track.
  await friend.page.goto(`/?view=history&people=${account.id}`);
  await expect(friend.page.getByRole("region", { name: "Summary", exact: true })).toContainText(
    `${account.displayName} · ${phone.name}`,
  );
  await friend.page.goto("about:blank");
  const actorId = `person:${friendAccount.id}`;
  await expect
    .poll(
      async () =>
        countOf((await summaryOf(page, actorId)).people[0]?.actions ?? [], ["getPersonTrack"]),
      {
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
  const [looks] = (await summaryOf(page, actorId)).people;
  if (looks === undefined) throw new Error("No looks recorded");
  const position = countOf(looks.actions, ["listPeople", "getPerson"]);
  const history = countOf(looks.actions, ["getPersonTrack"]);
  const live = countOf(looks.actions, ["live.position"]);
  expect(position).toBeGreaterThan(0);
  const sentence = `${friendAccount.displayName} looked at your live position ${times(position)} and your history ${times(history)}${live > 0 ? `, and received ${live} live update${live === 1 ? "" : "s"}` : ""}, last today at ${clock(looks.lastAt, account.timezone)}.`;

  await page.goto("/settings/privacy/viewers");
  await expect(title(page, "Who viewed you")).toBeVisible();
  const person = page.getByRole("list", { name: "People" }).getByRole("link", {
    name: friendAccount.displayName,
  });
  await expect(person).toHaveAccessibleDescription(sentence);
  const tiles = page.getByRole("group", { name: "Totals of the last 30 days" });
  await expect(tiles.getByText("People", { exact: true })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Accesses per day, by who" })).toBeVisible();
  await expectAccessible(page, "Who viewed you, with someone who looked");

  // Their page: what they read, hour by hour, each line with the devices and the precision.
  await person.click();
  await expect(title(page, friendAccount.displayName)).toBeVisible();
  await expect(page.getByText(sentence)).toBeVisible();
  const today = page.getByRole("region", { name: "Hour by hour" }).getByRole("list", {
    name: "Today",
  });
  const track = today.getByRole("listitem").filter({ hasText: "Your history" }).first();
  await track.locator("summary").click();
  await expect(track).toContainText(`Device${phone.name}`);
  await expect(track).toContainText(/Period\d+ \w+ \d{4}, 00:00 to /);
  await expect(track).toContainText("Answer200 OK");
  await expectAccessible(page, "the page of someone who looked");
  await page.getByRole("link", { name: "Back to Who viewed you" }).click();
  await expect(person).toBeFocused();

  // The share's page says it too.
  await page.goto(`/settings/sharing/${share.id}`);
  await expect(page.getByText(sentence)).toBeVisible();
  await expect(page.getByRole("figure", { name: "Looks by what they saw" })).toBeVisible();
  await expectAccessible(page, "a share's page with what they looked at");
});

test("a public link opened twice in another browser is one visitor and two views", async ({
  page,
  account,
  openBrowser,
}) => {
  await uploadedDevice(page, "Linked phone", overlandBatch(account.timezone));
  const made = await page.request.post(apiPaths.v1.shareLinks.root, {
    headers: fromPage(page),
    data: { label: "Counted link", precision: "approximate" },
  });
  expect(made.status()).toBe(201);
  const { link, url } = createShareLinkResponseSchema.parse(await made.json());

  const visitor = await openBrowser();
  let views = 0;
  visitor.page.on("response", (response) => {
    if (new URL(response.url()).pathname === apiPaths.publicShare && response.ok()) views += 1;
  });
  await visitor.page.goto(url);
  await expect(visitor.page.getByRole("heading", { level: 1, name: "Counted link" })).toBeVisible();
  await expect.poll(() => views).toBe(1);
  await visitor.page.reload();
  await expect(visitor.page.getByText("Linked phone")).toBeVisible();
  await expect.poll(() => views).toBe(2);
  await visitor.context.close();

  const actorId = `link:${link.id}`;
  await expect
    .poll(async () => (await summaryOf(page, actorId)).links[0]?.events ?? 0, { timeout: 20_000 })
    .toBe(views);
  const [counted] = (await summaryOf(page, actorId)).links;
  expect(counted?.visitors).toBe(1);

  await page.goto("/settings/privacy/viewers");
  await expect(
    page.getByRole("list", { name: "Public links" }).getByRole("link", { name: "Counted link" }),
  ).toHaveAccessibleDescription(
    `Opened twice by 1 visitor, last today at ${clock(counted?.lastAt ?? "", account.timezone)}.`,
  );
  const tiles = page.getByRole("group", { name: "Totals of the last 30 days" });
  await expect(tiles.locator(".stat-tile").filter({ hasText: "Link visitors" })).toContainText(
    "12 views",
  );

  // The link's own page: views per day and distinct visitors.
  await page.goto(`/settings/links/${link.id}`);
  const usage = page.getByRole("group", { name: "Views" });
  await expect(usage.locator(".stat-tile").filter({ hasText: "Views" })).toContainText("2");
  await expect(usage.locator(".stat-tile").filter({ hasText: "Visitors" })).toContainText("1");
  await expect(page.getByRole("figure", { name: "Views per day" })).toBeVisible();
  await expectAccessible(page, "a link's page with its views");
  await page.getByRole("link", { name: "Its visitors, hour by hour" }).click();
  await expect(title(page, "Counted link")).toBeVisible();
  const line = page.getByRole("list", { name: "Today" }).getByRole("listitem").first();
  await expect(line).toContainText("The link's page");
  // The visitor as their kind of browser and network, never their address (two views, or one
  // in each of two hours when the reload crossed one).
  await expect(line).toContainText(/, [0-9a-f.:]+\/(24|48) · (twice|once)/);
});

test("a token's API and MCP calls are counted apart, with what it did on its page", async ({
  page,
  account,
  request,
}) => {
  await uploadedDevice(page, "Token phone", overlandBatch(account.timezone));
  const { token, secret } = await tokenOf(page, "Usage token");
  const authorization = { Authorization: `Bearer ${secret}` };
  // Two operations of the API, and one tool of the MCP server.
  expect((await request.get(apiPaths.v1.me, { headers: authorization })).status()).toBe(200);
  expect((await request.get(apiPaths.v1.devices.root, { headers: authorization })).status()).toBe(
    200,
  );
  await mcp(request, secret, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1.0.0" },
    },
  });
  const called = await mcp(request, secret, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "list_devices", arguments: {} },
  });
  expect(called.result?.["isError"]).not.toBe(true);

  const actorId = `token:${token.id}`;
  await expect
    .poll(async () => (await summaryOf(page, actorId)).tokens[0]?.events ?? 0, { timeout: 20_000 })
    .toBe(3);
  const [used] = (await summaryOf(page, actorId)).tokens;
  expect(used).toMatchObject({ api: 2, mcp: 1 });
  const sentence = `Used 3 times: 2 API calls and 1 through MCP, last today at ${clock(used?.lastAt ?? "", account.timezone)}.`;

  await page.goto("/settings/privacy/viewers");
  await expect(
    page.getByRole("list", { name: "API tokens" }).getByRole("link", { name: "Usage token" }),
  ).toHaveAccessibleDescription(sentence);
  const tiles = page.getByRole("group", { name: "Totals of the last 30 days" });
  await expect(tiles.locator(".stat-tile").filter({ hasText: "API calls" })).toContainText(
    "2by 1 token",
  );
  await expect(tiles.locator(".stat-tile").filter({ hasText: "MCP calls" })).toContainText(
    "1by 1 token",
  );

  await page.goto(`/settings/tokens/${token.id}`);
  await expect(title(page, "Usage token")).toBeVisible();
  await expect(page.getByText(sentence)).toBeVisible();
  const chart = page.getByRole("figure", { name: "Calls per day" });
  await expect(chart.getByRole("list", { name: "Legend" })).toHaveText(/API.*MCP/);
  const last = page.getByRole("list", { name: "Last actions" });
  await expect(last.getByRole("listitem").filter({ hasText: "Profile" })).toContainText(
    "API · once · last today",
  );
  await expect(
    last.getByRole("listitem").filter({ hasText: /^Devices.*MCP server · once/ }),
  ).toHaveCount(1);
  await expect(last.getByRole("listitem").filter({ hasText: /^Devices.*API · once/ })).toHaveCount(
    1,
  );
  await expectAccessible(page, "a token's page with its use");
  await last.getByRole("link", { name: "Everything it did, hour by hour" }).click();
  await expect(title(page, "Usage token")).toBeVisible();
  await expect(page.getByRole("list", { name: "Today" }).getByRole("listitem")).toHaveCount(3);
  await expectAccessible(page, "the page of a token");
});

test("your own browsing stays out of the log until you switch it on", async ({ page, account }) => {
  await uploadedDevice(page, "Own phone", overlandBatch(account.timezone));
  // Browsing of one's own: the tracks of the day.
  await page.goto("/?view=history");
  await expect(page.getByRole("region", { name: "Summary", exact: true })).toContainText(
    "Own phone",
  );
  await expect
    .poll(
      async () => {
        const response = await page.request.get(apiPaths.v1.accessLog.root, {
          params: { actor: "owner" },
        });
        return dataAccessLogResponseSchema.parse(await response.json()).items.length;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  await page.goto("/settings/privacy/access-log");
  await expect(title(page, "Access log")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Nothing recorded yet" })).toBeVisible();
  await expectAccessible(page, "the access log without one's own activity");

  // The switch on the page shows it, and saves it as the account's preference.
  const own = page.getByRole("switch", { name: "Your own activity" });
  await own.check();
  const today = page.getByRole("list", { name: "Today" });
  await expect(today.getByRole("listitem").first()).toContainText(/^You/);
  await expect.poll(async () => (await currentUser(page)).preferences.showOwnActivity).toBe(true);
  await expect(
    page.getByRole("group", { name: "Filters" }).getByRole("combobox", { name: "Who" }),
  ).toContainText("You");
  await expectAccessible(page, "the access log with one's own activity");
  await page.goto("/settings/preferences");
  await expect(page.getByRole("switch", { name: "Your own activity" })).toBeChecked();

  await page.goto("/settings/privacy/viewers");
  const tiles = page.getByRole("group", { name: "Totals of the last 30 days" });
  await expect(tiles.getByText("Your own activity")).toBeVisible();
  await expect(page.getByRole("list", { name: "Your browsers" }).getByRole("link")).toHaveCount(1);
  await page.getByRole("switch", { name: "Your own activity" }).uncheck();
  await expect(
    page.getByRole("heading", { level: 2, name: "Nobody looked in the last 30 days" }),
  ).toBeVisible();
  await expect.poll(async () => (await currentUser(page)).preferences.showOwnActivity).toBe(false);
});

test("the access log filters by who, channel, period and action, and loads more", async ({
  page,
  account,
  request,
}) => {
  await uploadedDevice(page, "Busy phone", overlandBatch(account.timezone));
  const { secret } = await tokenOf(page, "Busy token");
  const authorization = { Authorization: `Bearer ${secret}` };
  // Sixty different ranges: more lines than a page holds (fifty), and within one hour more of one
  // kind than are listed one by one (fifty), so the rest fold into a line of their own.
  const started = Date.now();
  for (let day = 1; day <= 60; day += 1) {
    const from = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    const answer = await request.get(apiPaths.v1.stats.days, {
      headers: authorization,
      params: { from, to: "2026-03-31" },
    });
    expect(answer.status()).toBe(200);
  }
  const oneHour = Math.floor(started / 3_600_000) === Math.floor(Date.now() / 3_600_000);
  await expect
    .poll(async () => (await summaryOf(page)).totals.byChannel.api, { timeout: 20_000 })
    .toBe(60);

  await page.goto("/settings/privacy/access-log");
  await expect(title(page, "Access log")).toBeVisible();
  const lines = page.locator(".access-line");
  await expect(lines).toHaveCount(50);
  await expect(lines.first()).toContainText("Busy token");
  await expect(lines.first()).toContainText("Day statistics");
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("That is all: lines are kept for a year.")).toBeVisible();
  expect(await lines.count()).toBeGreaterThan(50);
  if (oneHour) {
    await expect(lines.filter({ hasText: "… and 10 more" })).toHaveCount(1);
  }

  const filters = page.getByRole("group", { name: "Filters" });
  await filters.getByRole("combobox", { name: "Who" }).selectOption({ label: "API tokens" });
  await expect(page).toHaveURL(/[?&]actor=token/);
  await filters.getByRole("combobox", { name: "Through" }).selectOption({ label: "MCP server" });
  await expect(
    page.getByRole("heading", { level: 2, name: "No lines match these filters" }),
  ).toBeVisible();
  await filters.getByRole("combobox", { name: "Through" }).selectOption({ label: "API" });
  await filters.getByRole("combobox", { name: "Period" }).selectOption({ label: "Today" });
  await expect(lines.first()).toContainText("Day statistics");
  await filters.getByRole("combobox", { name: "Action" }).selectOption({ label: "Exports" });
  await expect(page).toHaveURL(/[?&]action=dashboard\.export/);
  await expect(
    page.getByRole("heading", { level: 2, name: "No lines match these filters" }),
  ).toBeVisible();
  await expectAccessible(page, "the access log with filters");
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page).toHaveURL(/\/settings\/privacy\/access-log$/);
  // Everything again, as far as it had been loaded.
  await expect(page.getByText("That is all: lines are kept for a year.")).toBeVisible();

  // Every line opens to what it says.
  const listed = lines.filter({ hasNotText: "more" }).first();
  await listed.locator("summary").click();
  await expect(listed).toContainText("ThroughAPI");
  await expect(listed).toContainText("WhatDay statistics (listDayStats)");
  await expect(listed).toContainText(/Period\d+ \w+ 2026 to 31 Mar 2026/);
});

test.describe("on a 320 px wide screen", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the pages of the access log fit and stay accessible", async ({
    page,
    account,
    request,
  }) => {
    await uploadedDevice(page, "A phone with a rather long name", overlandBatch(account.timezone));
    const { token, secret } = await tokenOf(page, "A token with a rather long name");
    const authorization = { Authorization: `Bearer ${secret}` };
    expect((await request.get(apiPaths.v1.me, { headers: authorization })).status()).toBe(200);
    await expect
      .poll(async () => (await summaryOf(page)).tokens.length, { timeout: 20_000 })
      .toBe(1);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    for (const [path, name, loaded] of [
      ["/settings/privacy/viewers", "Who viewed you", "Accesses per day, by who"],
      ["/settings/privacy/access-log", "Access log", "Profile"],
      [`/settings/tokens/${token.id}`, "A token with a rather long name", "Calls per day"],
    ] as const) {
      await page.goto(path);
      await expect(title(page, name)).toBeVisible();
      await expect(page.getByText(loaded).first()).toBeVisible();
      expect(await overflow(), path).toBe(0);
      await expectAccessible(page, `${name} at 320 px`);
    }
    await page.goto("/settings/privacy/viewers");
    await page
      .getByRole("list", { name: "API tokens" })
      .getByRole("link", { name: "A token with a rather long name" })
      .click();
    await expect(page.getByRole("region", { name: "Hour by hour" })).toBeVisible();
    await page.locator(".access-line summary").first().click();
    expect(await overflow(), "an actor's page with a line open").toBe(0);
    await expectAccessible(page, "an actor's page at 320 px");
  });
});
