import { expect } from "@playwright/test";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceListResponseSchema } from "@trail/contracts/device";
import { adminStatePath } from "./support/adminState";
import { overlandBatch } from "./support/overlandBatch";
import { currentUser } from "./support/signUp";
import { test } from "./support/test";
import { uniqueEmail } from "./support/uniqueEmail";
import { uploadedDevice } from "./support/uploadedDevice";

test("an invited person gets an account of their own and sees nothing of anyone else's", async ({
  openBrowser,
  consoleGuard,
}) => {
  const admin = await openBrowser({ storageState: adminStatePath });
  const administrator = await currentUser(admin.page);
  test.skip(!administrator.isAdmin, "The server's first account belongs to someone else");
  const device = await uploadedDevice(
    admin.page,
    "Administrator's phone",
    overlandBatch(administrator.timezone),
  );

  // Bound to an address the allow-list does not cover: only the invite lets it in.
  const email = uniqueEmail("invited", "invited.trail.test");
  await admin.page.goto("/settings");
  const people = admin.page.getByRole("region", { name: "People", exact: true });
  await people.getByLabel("Email address (optional)").fill(email);
  await people.getByRole("button", { name: "Create invite" }).click();
  const link = await people.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

  const invited = await openBrowser();
  await invited.page.goto(link);
  await expect(
    invited.page.getByRole("heading", { level: 1, name: "You’re invited" }),
  ).toBeVisible();
  await expect(invited.page.getByLabel("Email address")).toHaveValue(email);
  await invited.page.getByRole("button", { name: "Create account with a passkey" }).click();
  await expect(
    invited.page.getByRole("heading", { name: "Connect your first phone" }),
  ).toBeVisible();
  const newcomer = await currentUser(invited.page);
  expect(newcomer).toMatchObject({ email, isAdmin: false });

  const own = deviceListResponseSchema.parse(
    await (await invited.page.request.get(apiPaths.devices.root)).json(),
  );
  expect(own.devices).toEqual([]);
  const day = {
    from: new Date(Date.now() - 86_400_000).toISOString(),
    to: new Date(Date.now() + 86_400_000).toISOString(),
  };
  for (const [path, params] of [
    [apiPaths.devices.one(device.id), {}],
    [apiPaths.devices.ingestLog(device.id), {}],
    [apiPaths.locations, { deviceId: device.id }],
    [apiPaths.tracks, { ...day, deviceIds: device.id }],
    [apiPaths.export, { ...day, format: "geojson", deviceIds: device.id }],
  ] as const) {
    const response = await invited.page.request.get(path, { params });
    expect(response.status(), path).toBe(404);
  }
  const tokenRotation = await invited.page.request.post(apiPaths.devices.token(device.id), {
    headers: { Origin: new URL(link).origin },
  });
  expect(tokenRotation.status()).toBe(404);

  consoleGuard.expectFailedResponse(404, /\/api\/devices\/[0-9a-f-]{36}$/);
  await invited.page.goto(`/devices/${device.id}`);
  await expect(
    invited.page.getByRole("heading", { level: 1, name: "Device not found" }),
  ).toBeVisible();

  await admin.page.reload();
  await expect(people.getByRole("listitem").filter({ hasText: email })).toContainText("Used");
});
