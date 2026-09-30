import { expect } from "@playwright/test";
import { addDevice } from "./support/addDevice";
import { deviceCard, fact } from "./support/deviceCard";
import { overlandBatch } from "./support/overlandBatch";
import { postOverland } from "./support/postOverland";
import { test } from "./support/test";

test("a new phone's first upload turns up on Live by itself", async ({
  page,
  account,
  request,
  baseURL,
}) => {
  const device = await addDevice(page, "Test iPhone");
  const { dialog } = device;
  await expect(dialog.getByRole("img", { name: /^Setup code for Test iPhone/ })).toBeVisible();
  expect(device.endpoint).toBe(`${baseURL}/api/overland`);
  expect(device.token).toMatch(/^trl_[A-Za-z0-9_-]{43}$/);
  expect(device.deviceKey).toMatch(/^test-iphone-[a-z0-9]{4}$/);
  const setupUrl = new URL(
    (await dialog.getByRole("link", { name: "Open in Overland" }).getAttribute("href")) ?? "",
  );
  expect(setupUrl.protocol).toBe("overland:");
  expect(Object.fromEntries(setupUrl.searchParams)).toEqual({
    url: device.endpoint,
    token: device.token,
    device_id: device.deviceKey,
  });
  await expect(dialog.getByText("Waiting for the first upload…")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Live", exact: true })
    .click();
  const card = deviceCard(page, "Test iPhone");
  await expect(card.getByText("No data yet")).toBeVisible();
  await expect(page.getByText("Live updates on")).toBeAttached();
  // Survives only if the page is not reloaded.
  await page.evaluate(() => Reflect.set(window, "trailE2eSamePage", true));

  const response = await postOverland(request, device.token, overlandBatch(account.timezone));
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ result: "ok" });

  await expect(card.getByText("Live", { exact: true })).toBeVisible();
  await expect(fact(card, "Points today")).toHaveText("30");
  await expect(fact(card, "Battery")).toContainText("77%");
  await expect(card.locator("p").filter({ hasText: "Last upload" })).toContainText(
    /just now|sec ago/,
  );
  await expect(card.getByText("Trip in progress")).toBeVisible();
  await expect(page.getByText(/1 of 1 device live/)).toBeVisible();
  const uploads = page.getByRole("region", { name: "Uploads", exact: true }).getByRole("listitem");
  await expect(uploads).toHaveCount(1);
  await expect(uploads.first()).toContainText("+30 points");
  await expect(uploads.first()).toContainText("New");
  expect(await page.evaluate(() => Reflect.get(window, "trailE2eSamePage"))).toBe(true);
});
