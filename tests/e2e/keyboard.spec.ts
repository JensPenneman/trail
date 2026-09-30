import { expect, type Page } from "@playwright/test";
import { postOverland } from "./support/postOverland";
import { test } from "./support/test";

/** Presses Tab until `target` has the focus (a keyboard user's way there). */
async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>, limit = 40) {
  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${String(target)}`);
}

test("a device can be added with the keyboard alone", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await page.goto("/devices");
  const addButton = page.getByRole("button", { name: "Add device", exact: true });
  await tabTo(page, addButton);
  await page.keyboard.press("Enter");

  const form = page.getByRole("dialog", { name: "Add a device" });
  // Focus starts in the name field.
  await expect(form.getByLabel("Name")).toBeFocused();
  await page.keyboard.type("Keyboard phone");
  await page.keyboard.press("Enter");

  const setup = page.getByRole("dialog", { name: "Set up Keyboard phone" });
  await expect(setup.getByRole("heading", { name: "Set up Keyboard phone" })).toBeFocused();
  await tabTo(page, setup.getByRole("textbox", { name: "Access token" }));
  const token = await setup.getByRole("textbox", { name: "Access token" }).inputValue();
  expect(token).toMatch(/^trl_/);
  await expect(setup.getByText("Waiting for the first upload…")).toBeVisible();
  await postOverland(page.request, token, { locations: [] });
  await expect(setup.getByText("First upload received")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  // Focus returns to where the dialog was opened from.
  await expect(addButton).toBeFocused();
  await expect(page.getByRole("link", { name: /^Keyboard phone/ })).toBeVisible();
});

test("a Device ID can be used only once per account", async ({ page, account, consoleGuard }) => {
  expect(account.email).toBeTruthy();
  consoleGuard.expectFailedResponse(409, /\/api\/devices$/);
  for (const name of ["First phone", "Second phone"]) {
    await page.goto("/devices?add=1");
    const form = page.getByRole("dialog", { name: "Add a device" });
    await form.getByLabel("Name").fill(name);
    await form.getByText("Device ID (optional)").click();
    await form.getByRole("textbox", { name: "Device ID" }).fill("shared-phone");
    await form.getByRole("button", { name: "Add device" }).click();
    if (name === "First phone") {
      await expect(page.getByRole("dialog", { name: "Set up First phone" })).toBeVisible();
    } else {
      await expect(form.getByText("Already used by another of your devices")).toBeVisible();
      await expect(form.getByRole("textbox", { name: "Device ID" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    }
  }
});
