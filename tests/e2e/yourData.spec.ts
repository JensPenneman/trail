import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { overlandBatch } from "./support/overlandBatch";
import { openSettingsConnected } from "./support/signOut";
import { currentUser } from "./support/signUp";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

/** Downloads the export in `format` through the Settings form; returns its name and text. */
async function download(
  page: Page,
  format: "geojson" | "gpx" | "csv",
): Promise<{ name: string; text: string }> {
  const form = page.getByRole("region", { name: "Your data", exact: true });
  await form.getByLabel("Format").selectOption(format);
  const started = page.waitForEvent("download");
  await form.getByRole("link", { name: "Download" }).click();
  const file = await started;
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), "utf8") };
}

test.describe("your data", () => {
  test("exports download as GeoJSON, GPX and CSV that read back", async ({ page, account }) => {
    await uploadedDevice(page, "Exported phone", overlandBatch(account.timezone));
    await page.goto("/settings");
    const fileName = /^trail-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.(geojson|gpx|csv)$/;

    const geojson = await download(page, "geojson");
    expect(geojson.name).toMatch(fileName);
    const collection = JSON.parse(geojson.text) as {
      type: string;
      features: { properties: { kind?: unknown } }[];
    };
    expect(collection.type).toBe("FeatureCollection");
    const kinds = collection.features.map((feature) => feature.properties.kind);
    expect(kinds.filter((kind) => kind === "location")).toHaveLength(30);
    expect(kinds.filter((kind) => kind === "visit")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "trip")).toHaveLength(1);

    const gpx = await download(page, "gpx");
    expect(gpx.name.endsWith(".gpx")).toBe(true);
    const parsed = await page.evaluate((text) => {
      const document = new DOMParser().parseFromString(text, "application/xml");
      return {
        error: document.querySelector("parsererror")?.textContent ?? null,
        points: document.getElementsByTagName("trkpt").length,
        waypoints: document.getElementsByTagName("wpt").length,
        tracks: [...document.getElementsByTagName("trk")].map(
          (track) => track.getElementsByTagName("name")[0]?.textContent,
        ),
      };
    }, gpx.text);
    expect(parsed).toEqual({ error: null, points: 30, waypoints: 1, tracks: ["Exported phone"] });

    const csv = await download(page, "csv");
    expect(csv.name.endsWith(".csv")).toBe(true);
    const lines = csv.text.split("\r\n").filter((line) => line !== "");
    expect(lines).toHaveLength(31);
    expect(lines[0]?.startsWith("device_id,device_name,device_key,recorded_at,")).toBe(true);
    expect(lines.slice(1).every((line) => line.includes(",Exported phone,"))).toBe(true);
  });

  test("deleting a period removes that day's points, visits and trips", async ({
    page,
    account,
  }) => {
    const device = await uploadedDevice(page, "Tidied phone", overlandBatch(account.timezone));
    await page.goto("/settings");
    const form = page.getByRole("region", { name: "Your data", exact: true });
    await form.getByLabel("Device", { exact: true }).selectOption({ label: "Tidied phone" });
    await form.getByRole("button", { name: "Delete data…" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this data?" });
    await expect(confirm).toContainText("Tidied phone");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    // 30 points, the visit, the trip and two app events.
    await expect(form.getByRole("status").filter({ hasText: "Deleted" })).toContainText(
      "34 records were removed.",
    );

    await page.goto(`/devices/${device.id}`);
    await expect(page.getByText("0 today · 0 in 24 h · 0 in total")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No points stored" })).toBeVisible();
  });

  test("deleting the account signs out, and the browser forgets the passkey", async ({
    page,
    account,
    authenticator,
    consoleGuard,
  }) => {
    // On the sign-in page afterwards, the passkey autofill (answered at once here) offers the
    // deleted account's passkey; the server no longer knows it (401 unknown_credential) and
    // the page tells the password manager to forget it through the WebAuthn Signal API.
    consoleGuard.expectFailedResponse(401, /\/api\/auth\/finish$/);
    await openSettingsConnected(page);
    await page.getByRole("button", { name: "Delete account…" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete your account?" });
    await confirm.getByLabel(`Type ${account.email} to confirm`).fill(account.email);
    await confirm.getByRole("button", { name: "Delete account" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);

    await expect(page.getByRole("alert")).toContainText("That passkey no longer works here");
    await expect.poll(() => authenticator.passkeys()).toEqual([]);
    const signedOut = await page.request.get("/api/auth/session");
    expect(signedOut.status()).toBe(401);
    await expect(currentUser(page)).rejects.toThrow();
  });
});
