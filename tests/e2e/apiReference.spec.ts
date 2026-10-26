import { expect } from "@playwright/test";
import { apiPaths } from "@trail/contracts/apiPaths";
import { test } from "./support/test";

/*
 * The reference is a third-party app (Scalar) on a page with a CSP of its own.
 * The console guard fails these tests on any CSP violation, console error or
 * request to another server — a CDN font or script would be all three.
 */
test("the API reference renders from the server itself, without CSP violations", {
  tag: "@signed-out",
}, async ({ page }) => {
  await page.goto(apiPaths.docs);
  await expect(page.getByRole("heading", { level: 1, name: "Trail API" })).toBeVisible();
  // The guide (docs/api.md) is the introduction.
  await expect(page.getByRole("heading", { name: "Rate limits" })).toBeAttached();
  // On a phone the sidebar hides behind a menu button.
  const menu = page.getByRole("button", { name: "Open Menu" });
  if (await menu.isVisible()) await menu.click();
  const sidebar = page.getByRole("complementary", { name: "Sidebar for Trail API" });
  await sidebar.getByRole("link", { name: "Devices", exact: true }).click();
  await sidebar.getByRole("link", { name: /^Get a device's location/ }).click();
  await expect(page.getByRole("heading", { name: "Get a device's location" })).toBeVisible();
  await expect(page.getByText("locations:read").first()).toBeVisible();
  // Nothing leads to Scalar's hosted client with this server's address.
  await expect(page.locator('a[href^="https://client.scalar.com"]')).toHaveCount(0);
});

test("the OpenAPI document is public, cacheable and open to other origins", {
  tag: "@signed-out",
}, async ({ request }) => {
  const response = await request.get(apiPaths.v1.openApi, {
    headers: { Origin: "https://tools.example" },
  });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["access-control-allow-origin"]).toBe("*");
  expect(headers["cache-control"]).toBe("public, max-age=300");
  const document = await response.json();
  expect(document).toMatchObject({ openapi: "3.1.1", info: { title: "Trail API" } });
  expect(Object.keys(document.paths)).toEqual(
    expect.arrayContaining([apiPaths.v1.me, apiPaths.v1.devices.root, apiPaths.v1.openApi]),
  );
  const unchanged = await request.get(apiPaths.v1.openApi, {
    headers: { "If-None-Match": headers["etag"] ?? "" },
  });
  expect(unchanged.status()).toBe(304);
});
