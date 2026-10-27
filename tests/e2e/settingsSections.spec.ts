import { expect } from "@playwright/test";
import { test } from "./support/test";

test("Settings has a section at an address of its own, and old anchors still lead there", async ({
  page,
  account,
}) => {
  expect(account.isAdmin).toBe(false);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page).toHaveTitle("Profile · Settings · Trail");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link")).toHaveText([
    "Profile",
    "Passkeys",
    "API tokens",
    "Sharing",
    "Data",
    "About",
  ]);
  await expect(sections.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await sections.getByRole("link", { name: "API tokens" }).click();
  await expect(page).toHaveURL(/\/settings\/tokens$/);
  // Focus moves to the section, not back to the page's heading.
  await expect(page.getByRole("heading", { name: "API tokens", exact: true })).toBeFocused();
  await expect(sections.getByRole("link", { name: "API tokens" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }),
  ).toHaveAttribute("aria-current", "page");

  // An anchor of the single page of old opens its section, at its part.
  await page.goto("/settings#browsers");
  await expect(page).toHaveURL(/\/settings\/passkeys#browsers$/);
  await expect(page.getByRole("heading", { name: "Signed-in browsers" })).toBeInViewport();
  await page.goto("/settings#tokens");
  await expect(page).toHaveURL(/\/settings\/tokens$/);

  // Accounts belong to administrators: everyone else lands on Profile.
  await page.goto("/settings/people");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(sections.getByRole("link", { name: "Accounts" })).toHaveCount(0);

  await page.goto("/settings/elsewhere");
  await expect(
    page.getByRole("heading", { level: 1, name: "This trail goes nowhere" }),
  ).toBeVisible();
});
