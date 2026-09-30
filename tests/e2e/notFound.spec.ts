import { expect } from "@playwright/test";
import { test } from "./support/test";

test("an unknown address shows the app's own 404 page", { tag: "@signed-out" }, async ({
  page,
}) => {
  const response = await page.goto("/no/such/page");
  // The server hands out the app for every page address; the app knows the page does not exist.
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "This trail goes nowhere" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Trail");
  await expect(page.getByRole("link", { name: "Go to Live" })).toHaveAttribute("href", "/");
});
