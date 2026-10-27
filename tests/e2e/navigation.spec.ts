import { expect } from "@playwright/test";
import { test } from "./support/test";

test("the main navigation: Map, People, Devices, Settings, a tab bar on phones", async ({
  page,
  account,
}, testInfo) => {
  expect(account.email).toBeTruthy();
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Map", "People", "Devices", "Settings"]);
  await expect(nav.getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");

  // Phones get a tab bar along the bottom edge; wide screens keep it in the header.
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("The navigation is not laid out");
  if (testInfo.project.name === "iphone") {
    expect(box.y + box.height).toBeCloseTo(viewport.height, 0);
  } else {
    expect(box.y).toBeLessThan(80);
  }

  await nav.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeFocused();
  await expect(nav.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Map" })).not.toHaveAttribute("aria-current");

  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();

  await nav.getByRole("link", { name: "Map" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeFocused();
});
