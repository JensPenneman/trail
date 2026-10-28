import { expect, type Locator } from "@playwright/test";
import { expectAccessible } from "./support/expectAccessible";
import { test } from "./support/test";

/** The configuration a setup link imports, read the way OwnTracks reads it. */
async function importedConfiguration(link: Locator): Promise<Record<string, unknown>> {
  const href = (await link.getAttribute("href")) ?? "";
  expect(href.startsWith("owntracks:///config?inline=")).toBe(true);
  const inline = href.slice("owntracks:///config?inline=".length);
  // Android's URLDecoder turns a bare + into a space: the base64 must be percent-encoded.
  expect(inline).not.toMatch(/[+/=]/);
  return JSON.parse(Buffer.from(decodeURIComponent(inline), "base64").toString("utf8"));
}

test("an OwnTracks phone is set up from its link and its first point turns up", async ({
  page,
  account,
  request,
  baseURL,
}) => {
  expect(account.email).toContain("@");
  await page.goto("/devices");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add a device" });
  await form.getByLabel("Name").fill("Lotte’s Pixel");
  const apps = form.getByRole("group", { name: "App on the phone" });
  await expect(apps.getByRole("radio")).toHaveCount(5);
  await apps.getByRole("radio", { name: /^OwnTracks/ }).check();
  await expectAccessible(page, "the add-device form with its apps");
  await form.getByRole("button", { name: "Add device" }).click();

  const dialog = page.getByRole("dialog", { name: "Set up Lotte’s Pixel" });
  await expect(dialog.getByText("Connect OwnTracks on the phone to Trail.")).toBeVisible();
  const value = (label: string) =>
    dialog.getByRole("textbox", { name: label, exact: true }).inputValue();
  const url = await value("URL");
  const username = await value("Username");
  // An iPhone sends the token in a header, which works over HTTP and HTTPS alike.
  const header = await value("HTTP Headers (access token)");
  const token = header.replace(/^Authorization: Bearer /, "");
  expect(url).toBe(`${baseURL}/api/owntracks`);
  expect(token).toMatch(/^trl_[A-Za-z0-9_-]{43}$/);
  expect(await value("Tracker ID")).toBe("LP");

  const link = dialog.getByRole("link", { name: "Open in OwnTracks" });
  const iphone = {
    _type: "configuration",
    mode: 3,
    url,
    auth: false,
    username,
    httpHeaders: `Authorization: Bearer ${token}`,
    deviceId: await value("Device ID"),
    tid: "LP",
    extendedData: true,
    monitoring: 2,
    locatorDisplacement: 30,
    locatorInterval: 60,
  };
  expect(await importedConfiguration(link)).toEqual(iphone);
  await expect(dialog.getByRole("img", { name: /^Setup code for Lotte’s Pixel/ })).toBeVisible();
  await expect(dialog.getByText(/at a high battery cost/)).toBeVisible();
  // Significant changes saves battery: the same link with iOS's own sparse fixes.
  await dialog.getByRole("radio", { name: "Significant changes" }).check();
  expect(await importedConfiguration(link)).toEqual({ ...iphone, monitoring: 1 });
  await dialog.getByRole("radio", { name: "Android" }).check();
  expect(await value("Password (access token)")).toBe(token);
  expect(await importedConfiguration(link)).toMatchObject({
    auth: true,
    username,
    password: token,
    monitoring: 1,
    // By name: Android reads a number as a position in its list of priorities.
    locatorPriority: "HighAccuracy",
    locatorInterval: 15,
    locatorDisplacement: 25,
  });
  await expect(
    dialog.getByRole("heading", { name: "Recommended OwnTracks settings on Android" }),
  ).toBeVisible();
  await expect(dialog.getByText("Waiting for the first upload…")).toBeVisible();
  await expectAccessible(page, "OwnTracks' setup");

  const location = {
    _type: "location",
    lat: 51.0543,
    lon: 3.7174,
    tst: Math.floor(Date.now() / 1000) - 60,
    acc: 8,
    vel: 18,
    batt: 64,
    bs: 1,
    tid: "LP",
  };
  // The suite's server was given an http:// address: Android's Basic authentication works on it
  // like the iPhone's bearer header (an https:// address would refuse both over plain HTTP).
  const basic = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
  const android = await request.post("/api/owntracks", {
    headers: { Authorization: basic, "Content-Type": "application/json" },
    data: location,
  });
  expect(android.status()).toBe(200);
  expect(await android.json()).toEqual([]);
  await expect(dialog.getByText("First upload received")).toBeVisible();
  const iphoneUpload = await request.post("/api/owntracks", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { ...location, tst: location.tst + 1 },
  });
  expect(iphoneUpload.status()).toBe(200);

  await dialog.getByRole("link", { name: "Open device page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lotte’s Pixel" })).toBeVisible();
  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview.getByText("OwnTracks", { exact: true })).toBeVisible();
  // "today" would depend on the minute after midnight; the total does not.
  await expect(overview.getByText(/· 2 in total$/)).toBeVisible();
  // Overland's presets are Overland's: no tracking settings for OwnTracks.
  await expect(page.getByRole("region", { name: "Tracking settings" })).toHaveCount(0);
  const setup = page.getByRole("region", { name: "Setup" });
  await expect(setup.getByText(url)).toBeVisible();
  const uploads = page.getByRole("table", { name: "Uploads of this device" });
  // The header row and one row per upload.
  await expect(uploads.getByRole("row")).toHaveCount(3);
  await expectAccessible(page, "an OwnTracks device's page");
});
