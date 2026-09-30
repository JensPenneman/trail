import { expect, type Locator, type Page } from "@playwright/test";

/** A device as the add-device dialog shows it: the one-time credentials for the phone. */
export interface AddedDevice {
  id: string;
  name: string;
  endpoint: string;
  token: string;
  deviceKey: string;
  /** The setup dialog, still open (waiting for the first upload). */
  dialog: Locator;
}

/**
 * Adds a device through Devices → Add device and reads the credentials the
 * dialog shows, as someone setting up a phone by hand would.
 */
export async function addDevice(
  page: Page,
  name: string,
  options: { deviceKey?: string } = {},
): Promise<AddedDevice> {
  await page.goto("/devices");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add a device" });
  await form.getByLabel("Name").fill(name);
  if (options.deviceKey !== undefined) {
    await form.getByText("Device ID (optional)").click();
    await form.getByRole("textbox", { name: "Device ID" }).fill(options.deviceKey);
  }
  await form.getByRole("button", { name: "Add device" }).click();
  const dialog = page.getByRole("dialog", { name: `Set up ${name}` });
  await expect(dialog).toBeVisible();
  const value = (label: string) => dialog.getByRole("textbox", { name: label }).inputValue();
  const href = await dialog.getByRole("link", { name: "Open device page" }).getAttribute("href");
  const id = /^\/devices\/([0-9a-f-]{36})$/.exec(href ?? "")?.[1];
  if (id === undefined) throw new Error(`No device page link in the setup dialog: ${href}`);
  return {
    id,
    name,
    endpoint: await value("Receiver endpoint"),
    token: await value("Access token"),
    deviceKey: await value("Device ID"),
    dialog,
  };
}
