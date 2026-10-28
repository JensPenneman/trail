import { expect, type Page, type TestInfo } from "@playwright/test";
import { apiPaths } from "@trail/contracts/apiPaths";
import { apiTokenWithSecretResponseSchema } from "@trail/contracts/apiToken";
import { publicConfigSchema } from "@trail/contracts/config";
import { shareResponseSchema } from "@trail/contracts/share";
import { createShareLinkResponseSchema } from "@trail/contracts/shareLink";
import { adminStatePath } from "./support/adminState";
import { expectAccessible } from "./support/expectAccessible";
import { openMapOptions } from "./support/mapControls";
import { overlandBatch } from "./support/overlandBatch";
import { currentUser } from "./support/signUp";
import { test } from "./support/test";
import { uniqueEmail } from "./support/uniqueEmail";
import { uploadedDevice } from "./support/uploadedDevice";

/** On a phone the list of Settings is a page of its own; on wide screens it stands beside the page. */
const onPhone = (testInfo: TestInfo) => testInfo.project.name === "iphone";

const list = (page: Page) => page.getByRole("navigation", { name: "Settings" });
const title = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

/** Opens a page of Settings by its address and waits for its title and what it loads. */
async function open(page: Page, path: string, name: string, ready: string | RegExp) {
  await page.goto(path);
  await expect(title(page, name)).toBeVisible();
  await expect(page.getByText(ready).first()).toBeVisible();
}

/** An unsafe request of the signed-in page, from its own origin as the CSRF guard asks. */
const fromPage = (page: Page) => ({ Origin: new URL(page.url()).origin });

test("Settings: the rows of every group with their values, and search", async ({
  page,
  account,
}, testInfo) => {
  expect(account.isAdmin).toBe(false);
  const config = publicConfigSchema.parse(await (await page.request.get(apiPaths.config)).json());
  await page.goto("/settings");
  if (onPhone(testInfo)) {
    await expect(page).toHaveURL(/\/settings$/);
    await expect(title(page, "Settings")).toBeVisible();
    await expect(page).toHaveTitle("Settings · Trail");
  } else {
    // Beside the list, the first page opens with it.
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(title(page, "Profile")).toBeVisible();
    await expect(list(page).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  const groups = list(page).getByRole("list");
  await expect(groups).toHaveCount(4);
  await expect(list(page).getByRole("list", { name: "Account" }).getByRole("link")).toHaveCount(4);
  for (const [name, path] of [
    ["Profile", "/settings/profile"],
    ["Devices", "/settings/devices"],
    ["Passkeys", "/settings/passkeys"],
    ["Browsers", "/settings/browsers"],
    ["Sharing", "/settings/sharing"],
    ["Public links", "/settings/links"],
    ["Who viewed you", "/settings/privacy/viewers"],
    ["Access log", "/settings/privacy/access-log"],
    ["Your data", "/settings/data"],
    ["API tokens", "/settings/tokens"],
    ["MCP", "/settings/mcp"],
    ["API reference", "/docs"],
    ["Preferences", "/settings/preferences"],
    ["Notifications", "/settings/notifications"],
    ["About", "/settings/about"],
  ] as const) {
    await expect(list(page).getByRole("link", { name, exact: true }), name).toHaveAttribute(
      "href",
      path,
    );
  }
  await expect(list(page).getByRole("link", { name: "Accounts" })).toHaveCount(0);
  await expect(list(page).getByRole("link", { name: "Passkeys" })).toHaveAccessibleDescription("1");
  await expect(list(page).getByRole("link", { name: "Browsers" })).toHaveAccessibleDescription("1");
  await expect(list(page).getByRole("link", { name: "About" })).toHaveAccessibleDescription(
    config.version,
  );
  // This server sends no alerts (no ALERT_NTFY_URL).
  await expect(list(page).getByRole("link", { name: "Notifications" })).toHaveAccessibleDescription(
    "Off",
  );
  await expectAccessible(page, "the list of Settings");

  const search = page.getByRole("searchbox", { name: "Search Settings" });
  await search.fill("zzz");
  await expect(page.getByText("No settings match “zzz”.")).toBeVisible();
  await search.fill("gpx");
  const results = page.getByRole("list", { name: "Results" });
  await expect(results.getByRole("link", { name: "Export" })).toHaveAccessibleDescription(
    "Privacy & data › Your data",
  );
  await expect(list(page)).toHaveCount(0);
  await expectAccessible(page, "search results in Settings");
  await search.fill("export");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/settings\/data#export$/);
  await expect(title(page, "Your data")).toBeVisible();
  // Focus lands on the part the address names, which is in view.
  const exportHeading = page.getByRole("heading", { level: 2, name: "Export" });
  await expect(exportHeading).toBeFocused();
  await expect(exportHeading).toBeInViewport();
});

test("every page of Settings, and the page of each kind of item, renders and is accessible", async ({
  page,
  account,
}, testInfo) => {
  // Twenty-four pages, each loaded by its address and scanned by axe.
  test.slow();
  const device = await uploadedDevice(page, "Settings phone", overlandBatch(account.timezone));
  for (const [path, name, ready] of [
    ["/settings/profile", "Profile", "Time zone"],
    ["/settings/devices", "Devices", "Settings phone"],
    ["/settings/passkeys", "Passkeys", "works on this address"],
    ["/settings/browsers", "Browsers", "This browser"],
    ["/settings/sharing", "Sharing", "Nobody sees your location."],
    ["/settings/links", "Public links", "No links yet."],
    ["/settings/privacy/viewers", "Who viewed you", "Nobody looked in the last 30 days"],
    ["/settings/privacy/access-log", "Access log", "Nothing recorded yet"],
    ["/settings/data", "Your data", "Delete a period"],
    ["/settings/tokens", "API tokens", "No active tokens."],
    ["/settings/mcp", "MCP", "Server address"],
    ["/settings/preferences", "Preferences", "Detail of the tracks"],
    ["/settings/notifications", "Notifications", "Settings phone"],
    ["/settings/about", "About", "OwnTracks endpoint"],
  ] as const) {
    await open(page, path, name, ready);
    await expect(page).toHaveTitle(`${name} · Settings · Trail`);
    await expectAccessible(page, `Settings › ${name}`);
  }

  // A device's page, and the pages of its parts one level deeper.
  await open(page, `/settings/devices/${device.id}`, "Settings phone", "Overview");
  await expect(page).toHaveTitle("Settings phone · Devices · Settings · Trail");
  await expectAccessible(page, "a device's page");
  for (const [part, name, ready] of [
    ["uploads", "Uploads", "Overland"],
    ["points", "Raw points", "25 shown"],
    ["tracking", "Tracking settings", "Send with next upload"],
    ["setup", "Setup", "Recommended Overland settings"],
  ] as const) {
    await open(page, `/settings/devices/${device.id}/${part}`, name, ready);
    await expect(page).toHaveTitle(`${name} · Settings phone · Devices · Settings · Trail`);
    await expectAccessible(page, `a device's ${name.toLowerCase()}`);
  }

  // Search finds the device by its name, and leads to its page.
  await page.goto(onPhone(testInfo) ? "/settings" : "/settings/devices");
  const search = page.getByRole("searchbox", { name: "Search Settings" });
  await search.fill("settings phone");
  await expect(
    page.getByRole("list", { name: "Results" }).getByRole("link", { name: "Settings phone" }),
  ).toHaveAccessibleDescription("Account › Devices");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/settings/devices/${device.id}$`));
  await expect(title(page, "Settings phone")).toBeFocused();

  // A passkey's page, from the list.
  await page.goto("/settings/passkeys");
  await page.getByRole("list", { name: "Your passkeys" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/settings\/passkeys\/[^/]+$/);
  await expect(page.getByRole("button", { name: "Delete passkey" })).toBeVisible();
  await expectAccessible(page, "a passkey's page");

  // A token's, a share's and a public link's page, each made through the API.
  const token = apiTokenWithSecretResponseSchema.parse(
    await (
      await page.request.post(apiPaths.me.tokens, {
        headers: fromPage(page),
        data: { name: "Checked token", scopes: ["devices:read"], expiresAt: null },
      })
    ).json(),
  ).token;
  await open(page, `/settings/tokens/${token.id}`, "Checked token", "Never used");
  await expect(page).toHaveTitle("Checked token · API tokens · Settings · Trail");
  await expectAccessible(page, "a token's page");

  const share = shareResponseSchema.parse(
    await (
      await page.request.post(apiPaths.v1.shares.root, {
        headers: fromPage(page),
        data: { email: uniqueEmail("pending"), precision: "area", duration: "week" },
      })
    ).json(),
  ).share;
  await open(page, `/settings/sharing/${share.id}`, share.recipient.email, "Waiting for them");
  await expectAccessible(page, "a share's page");

  const link = createShareLinkResponseSchema.parse(
    await (
      await page.request.post(apiPaths.v1.shareLinks.root, {
        headers: fromPage(page),
        data: { label: "Checked link", precision: "approximate" },
      })
    ).json(),
  ).link;
  await open(page, `/settings/links/${link.id}`, "Checked link", "Not opened yet");
  await expectAccessible(page, "a public link's page");

  // An item that does not exist has a page that says so.
  await open(page, `/settings/tokens/${link.id}`, "API token not found", "no such API token");
  await expectAccessible(page, "the page of a missing item");
});

test("going deeper and back, by address and through the browser's history", async ({
  page,
  account,
}, testInfo) => {
  expect(account.id).toBeTruthy();
  if (onPhone(testInfo)) {
    await page.goto("/settings");
    await list(page).getByRole("link", { name: "Passkeys" }).click();
  } else {
    await page.goto("/settings/profile");
    await list(page).getByRole("link", { name: "Passkeys" }).click();
  }
  await expect(page).toHaveURL(/\/settings\/passkeys$/);
  await expect(title(page, "Passkeys")).toBeFocused();
  const passkeys = page.getByRole("list", { name: "Your passkeys" });
  const passkey = passkeys.getByRole("link").first();
  const name = (await passkey.getAttribute("aria-labelledby")) ?? "";
  const passkeyName = (await page.locator(`[id="${name}"]`).textContent()) ?? "";
  await passkey.click();
  await expect(title(page, passkeyName)).toBeFocused();
  await expect(page).toHaveTitle(`${passkeyName} · Passkeys · Settings · Trail`);

  // Back goes back in the history, and focus returns to the row it came from.
  await page.getByRole("link", { name: "Back to Passkeys" }).click();
  await expect(page).toHaveURL(/\/settings\/passkeys$/);
  await expect(passkeys.getByRole("link", { name: passkeyName })).toBeFocused();
  await page.goForward();
  await expect(title(page, passkeyName)).toBeVisible();
  await page.goBack();
  await expect(title(page, "Passkeys")).toBeVisible();

  // Opened by its address, the page's way back leads to the page above it.
  await page.goto(page.url().replace(/\/passkeys$/, "/browsers"));
  await expect(title(page, "Browsers")).toBeVisible();
  if (onPhone(testInfo)) {
    await page.getByRole("link", { name: "Back to Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(title(page, "Settings")).toBeVisible();
  } else {
    // Beside the list, a page of the list has no way back of its own.
    await expect(page.getByRole("link", { name: "Back to Settings" })).toBeHidden();
  }

  // Anchors of the single Settings page of 0.2 and the accounts' old address still lead somewhere.
  await page.goto("/settings#browsers");
  await expect(page).toHaveURL(/\/settings\/browsers$/);
  await expect(title(page, "Browsers")).toBeVisible();
  await page.goto("/settings#link");
  await expect(page).toHaveURL(/\/settings\/passkeys#passkey-link$/);
  await expect(
    page.getByRole("heading", { name: "Add a passkey on another device or address" }),
  ).toBeInViewport();
  await page.goto("/settings/people");
  await expect(page).toHaveURL(onPhone(testInfo) ? /\/settings$/ : /\/settings\/profile$/);
  await page.goto("/settings/elsewhere");
  await expect(title(page, "This trail goes nowhere")).toBeVisible();
});

test("the account's preferences are what the map opens with", async ({ page, account }) => {
  await uploadedDevice(page, "Preferred phone", overlandBatch(account.timezone));
  const config = publicConfigSchema.parse(await (await page.request.get(apiPaths.config)).json());
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings/preferences");
  const style = page.getByRole("combobox", { name: "Map style" });
  await expect(style).toHaveValue("auto");
  await style.selectOption("dark");
  await expect(page.getByText("Map style saved: Dark.")).toBeAttached();
  await page.getByRole("combobox", { name: "Detail of the tracks" }).selectOption("raw");
  await expect(page.getByText("Detail of the tracks saved: Raw.")).toBeAttached();
  await page.getByRole("switch", { name: "Your own activity" }).check();
  await expect(page.getByText("The access log lists your own activity too.")).toBeAttached();
  expect((await currentUser(page)).preferences).toEqual({
    mapStyle: "dark",
    level: "raw",
    showOwnActivity: true,
  });

  // A dark map on a light system: the preference, not Auto.
  const dark = page.waitForRequest(config.mapStyles.dark);
  await page.goto("/?view=history");
  await dark;
  await openMapOptions(page);
  const styles = page.getByRole("group", { name: "Map style" });
  await expect(styles.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(
    page.getByRole("group", { name: "Detail of the tracks" }).getByRole("radio", { name: "Raw" }),
  ).toBeChecked();

  // A choice on the map wins on this browser, until a preference is saved here again.
  await styles.getByRole("radio", { name: "Light" }).click();
  await expect(page).toHaveURL(/[?&]style=light/);
  await page.goto("/?view=history");
  await openMapOptions(page);
  await expect(styles.getByRole("radio", { name: "Light" })).toBeChecked();
  await page.goto("/settings/preferences");
  await page.getByRole("combobox", { name: "Map style" }).selectOption("auto");
  await expect(page.getByText("Map style saved: Auto.")).toBeAttached();
  await page.goto("/?view=history");
  await openMapOptions(page);
  await expect(styles.getByRole("radio", { name: "Auto" })).toBeChecked();
});

test("the administrators' page is theirs alone", async ({
  page,
  account,
  openBrowser,
}, testInfo) => {
  expect(account.isAdmin).toBe(false);
  await page.goto("/settings/accounts");
  await expect(page).toHaveURL(onPhone(testInfo) ? /\/settings$/ : /\/settings\/profile$/);
  await expect(list(page).getByRole("link", { name: "Accounts" })).toHaveCount(0);

  const admin = await openBrowser({ storageState: adminStatePath });
  test.skip(
    !(await currentUser(admin.page)).isAdmin,
    "The server's first account belongs to someone else",
  );
  await admin.page.goto(onPhone(testInfo) ? "/settings" : "/settings/profile");
  const accounts = list(admin.page).getByRole("link", { name: "Accounts" });
  await expect(list(admin.page).getByRole("list", { name: "Admin" })).toBeVisible();
  await accounts.click();
  await expect(admin.page).toHaveURL(/\/settings\/accounts$/);
  await expect(title(admin.page, "Accounts")).toBeFocused();
  await expect(admin.page.getByRole("heading", { name: "Accounts on this server" })).toBeVisible();
  await expectAccessible(admin.page, "Settings › Accounts");
  // Accounts lived at /settings/people in 0.3.
  await admin.page.goto("/settings/people");
  await expect(admin.page).toHaveURL(/\/settings\/accounts$/);
});
