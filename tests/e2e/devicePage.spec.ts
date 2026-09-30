import { expect, type Page } from "@playwright/test";
import { type OverlandBatch, overlandBatch } from "./support/overlandBatch";
import { overlandUserAgent, postOverland } from "./support/postOverland";
import { test } from "./support/test";
import { uploadedDevice as deviceWithUpload } from "./support/uploadedDevice";

/** A device with the fixture's batch already uploaded; ends on its page. */
async function uploadedDevice(page: Page, name: string, batch: OverlandBatch) {
  const device = await deviceWithUpload(page, name, batch);
  await page.goto(`/devices/${device.id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return device;
}

const cells = (row: ReturnType<Page["getByRole"]>) => row.getByRole("cell");

test.describe("a device's page", () => {
  test("lists every upload and the raw points as they were stored", async ({ page, account }) => {
    const batch = overlandBatch(account.timezone);
    const device = await uploadedDevice(page, "Logged phone", batch);
    const uploads = page.getByRole("table", { name: "Uploads of this device" });
    const rows = uploads.getByRole("row");
    await expect(rows).toHaveCount(2);
    // Received, records, new, already stored, visits, trips, events, rejected, took, app
    await expect(cells(rows.nth(1)).nth(1)).toHaveText("34");
    await expect(cells(rows.nth(1)).nth(2)).toHaveText("30");
    await expect(cells(rows.nth(1)).nth(3)).toHaveText("0");
    await expect(cells(rows.nth(1)).nth(4)).toHaveText("1");
    await expect(cells(rows.nth(1)).nth(5)).toHaveText("1");
    await expect(cells(rows.nth(1)).nth(6)).toHaveText("2");
    await expect(cells(rows.nth(1)).nth(7)).toHaveText("0");
    await expect(cells(rows.nth(1)).nth(9)).toHaveText(overlandUserAgent);

    // Overland resends a batch it saw no answer for: stored once, logged twice.
    expect((await postOverland(page.request, device.token, batch)).status()).toBe(200);
    await expect(rows).toHaveCount(3);
    await expect(cells(rows.nth(1)).nth(2)).toHaveText("0");
    await expect(cells(rows.nth(1)).nth(3)).toHaveText("30");
    await expect(page.getByText("30 today · 30 in 24 h · 30 in total")).toBeVisible();

    const points = page.getByRole("region", { name: "Raw points", exact: true });
    await expect(points.getByRole("status")).toHaveText("25 shown");
    await points.getByRole("button", { name: "Load older points" }).click();
    await expect(points.getByRole("status")).toHaveText("30 shown");
    await expect(points.getByText("That is every stored point.")).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Stored points of this device" }).getByRole("row"),
    ).toHaveCount(31);
  });

  test("sends a tracking preset to the phone with its next upload, exactly once", async ({
    page,
    account,
  }) => {
    const batch = overlandBatch(account.timezone);
    const device = await uploadedDevice(page, "Tuned phone", batch);
    const settings = page.getByRole("region", { name: "Tracking settings", exact: true });
    await expect(settings.getByText("No preset has been sent to this phone yet.")).toBeVisible();
    await settings.getByRole("radio", { name: /^Balanced/ }).check();
    await settings.getByRole("button", { name: "Send with next upload" }).click();
    await expect(settings.getByText("“Balanced” is queued")).toBeVisible();

    const next = await postOverland(page.request, device.token, { locations: [] });
    expect(await next.json()).toEqual({
      result: "ok",
      set: {
        send_interval: "5m",
        main: {
          tracking_mode: "standard",
          visit_tracking: true,
          desired_accuracy: "100m",
          activity_type: "other",
          pause_automatically: true,
          resume_with_geofence: "200m",
          logging_mode: "all",
          batch_size: 200,
          min_distance: "10m",
          min_time: "5s",
        },
      },
    });
    const after = await postOverland(page.request, device.token, { locations: [] });
    expect(await after.json()).toEqual({ result: "ok" });

    // The page learns about the delivery from the event stream.
    await expect(settings.getByText("“Balanced” is queued")).toBeHidden();
    await expect(settings.getByText(/^Last preset delivered /)).toBeVisible();
  });

  test("issues a new access token that locks the old one out", async ({ page, account }) => {
    const device = await uploadedDevice(page, "Handed-down phone", overlandBatch(account.timezone));
    await page.getByRole("button", { name: "Issue new token" }).click();
    const confirm = page.getByRole("dialog", { name: "Issue a new access token?" });
    await confirm.getByRole("button", { name: "Issue new token" }).click();
    const issued = page.getByRole("dialog", { name: "New token for Handed-down phone" });
    const token = await issued.getByRole("textbox", { name: "Access token" }).inputValue();
    expect(token).toMatch(/^trl_[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(device.token);
    await expect(issued.getByText("Waiting for an upload with the new token…")).toBeVisible();

    const old = await postOverland(page.request, device.token, { locations: [] });
    expect(old.status()).toBe(401);
    expect(await old.json()).toEqual({ error: "Invalid access token" });
    const fresh = await postOverland(page.request, token, { locations: [] });
    expect(await fresh.json()).toEqual({ result: "ok" });
    await expect(issued.getByText("The phone uses the new token")).toBeVisible();
    await issued.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(`…${token.slice(-4)}`).first()).toBeVisible();
  });

  test("can be renamed, and deleted once its name is typed", async ({ page, account }) => {
    const device = await uploadedDevice(page, "Old phone", overlandBatch(account.timezone));
    await page.getByRole("button", { name: "Rename" }).click();
    const rename = page.getByRole("dialog", { name: "Rename device" });
    await rename.getByLabel("Name").fill("Retired phone");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Retired phone" })).toBeVisible();

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete Retired phone?" });
    await expect(confirm).toContainText("all 30 of its points");
    const remove = confirm.getByRole("button", { name: "Delete device" });
    await expect(remove).toBeDisabled();
    await confirm.getByLabel("Type “Retired phone” to confirm").fill("Retired phone");
    await remove.click();
    await expect(page).toHaveURL(/\/devices$/);
    await expect(page.getByRole("heading", { name: "No devices yet" })).toBeVisible();
    const gone = await page.request.get(`/api/devices/${device.id}`);
    expect(gone.status()).toBe(404);
    // Its phone is refused from now on, so it knows to stop.
    const upload = await postOverland(page.request, device.token, { locations: [] });
    expect(upload.status()).toBe(401);
  });
});
