import { expect } from "@playwright/test";
import { addDevice } from "./support/addDevice";
import { mapView } from "./support/mapControls";
import { test } from "./support/test";

test("the main navigation: People, Insights, Settings, a tab bar on phones", async ({
  page,
  account,
}, testInfo) => {
  expect(account.email).toBeTruthy();
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["People", "Insights", "Settings"]);
  await expect(nav.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle("Live · People · Trail");

  // Phones get a tab bar along the bottom edge; wide screens keep it in the header.
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("The navigation is not laid out");
  if (testInfo.project.name === "iphone") {
    expect(box.y + box.height).toBeCloseTo(viewport.height, 0);
  } else {
    expect(box.y).toBeLessThan(80);
  }

  await nav.getByRole("link", { name: "Insights" }).click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeFocused();
  await expect(nav.getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "People" })).not.toHaveAttribute("aria-current");

  // The list of Settings on a phone; beside it on wide screens, with its first page.
  await nav.getByRole("link", { name: "Settings" }).click();
  if (testInfo.project.name === "iphone") {
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  } else {
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeFocused();
  }
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");

  // The devices live in Settings now: its row, and Settings stays the current item.
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Devices" })
    .click();
  await expect(page).toHaveURL(/\/settings\/devices$/);
  await expect(page.getByRole("heading", { level: 1, name: "Devices" })).toBeFocused();
  await expect(page).toHaveTitle("Devices · Settings · Trail");
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeFocused();
});

test("the Devices page's old addresses lead into Settings, in place of the old entry", async ({
  page,
  account,
}) => {
  expect(account.email).toBeTruthy();
  const device = await addDevice(page, "Bookmarked phone");
  await device.dialog.getByRole("button", { name: "Done" }).click();

  await page.goto("/insights");
  await page.goto("/devices?add=1");
  await expect(page).toHaveURL(/\/settings\/devices\?add=1$/);
  await expect(page.getByRole("dialog", { name: "Add a device" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }),
  ).toHaveAttribute("aria-current", "page");
  // Replaced: Back skips the old address.
  await page.goBack();
  await expect(page).toHaveURL(/\/insights$/);

  // A device's page of old, opened from Insights: its page in Settings, Back to Insights.
  await page.goto(`/devices/${device.id}`);
  await expect(page).toHaveURL(new RegExp(`/settings/devices/${device.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Bookmarked phone" })).toBeVisible();
  await expect(page).toHaveTitle("Bookmarked phone · Devices · Settings · Trail");
  await page.goBack();
  await expect(page).toHaveURL(/\/insights$/);
});

test("the People page's old address leads home, with its parameters", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await page.goto("/insights");
  await page.goto("/people?view=history&level=raw");
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.search === "?view=history&level=raw",
  );
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(mapView(page, "History")).toBeChecked();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "People" }),
  ).toHaveAttribute("aria-current", "page");
  // The old address was replaced: Back skips it.
  await page.goBack();
  await expect(page).toHaveURL(/\/insights$/);

  await page.goto("/people");
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
  await expect(mapView(page, "Live")).toBeChecked();
});
