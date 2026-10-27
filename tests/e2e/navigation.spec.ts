import { expect } from "@playwright/test";
import { mapView } from "./support/mapControls";
import { test } from "./support/test";

test("the main navigation: People, Devices, Settings, a tab bar on phones", async ({
  page,
  account,
}, testInfo) => {
  expect(account.email).toBeTruthy();
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["People", "Devices", "Settings"]);
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

  await nav.getByRole("link", { name: "Devices" }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByRole("heading", { level: 1, name: "Devices" })).toBeFocused();
  await expect(nav.getByRole("link", { name: "Devices" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "People" })).not.toHaveAttribute("aria-current");

  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();

  await nav.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeFocused();
});

test("the People page's old address leads home, with its parameters", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await page.goto("/devices");
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
  await expect(page).toHaveURL(/\/devices$/);

  await page.goto("/people");
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
  await expect(mapView(page, "Live")).toBeChecked();
});
