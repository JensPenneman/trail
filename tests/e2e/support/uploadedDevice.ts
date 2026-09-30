import { expect, type Page } from "@playwright/test";
import { addDevice } from "./addDevice";
import type { OverlandBatch } from "./overlandBatch";
import { postOverland } from "./postOverland";

/** A device added through the UI whose phone has uploaded `batch`. */
export async function uploadedDevice(page: Page, name: string, batch: OverlandBatch) {
  const device = await addDevice(page, name);
  const response = await postOverland(page.request, device.token, batch);
  expect(response.status()).toBe(200);
  await expect(device.dialog.getByText("First upload received")).toBeVisible();
  await device.dialog.getByRole("button", { name: "Done" }).click();
  return device;
}
