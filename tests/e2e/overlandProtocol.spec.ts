import { expect } from "@playwright/test";
import { locationsPageSchema } from "@trail/contracts/location";
import { addDevice } from "./support/addDevice";
import { deviceCard, fact } from "./support/deviceCard";
import { overlandBatch } from "./support/overlandBatch";
import { postOverland } from "./support/postOverland";
import { test } from "./support/test";

/** `2026-10-01T08:00:00-0700`: the offset without a colon that old Overland versions sent. */
function legacyTimestamp(instant: Date): string {
  const local = new Date(instant.getTime() - 7 * 3_600_000).toISOString().slice(0, 19);
  return `${local}-0700`;
}

const point = (timestamp: string, coordinates: number[] = [3.7174, 51.0543]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties: { timestamp, horizontal_accuracy: 10, device_id: "replayed" },
});

test("uploads behave the way the Overland app relies on", async ({ page, account, request }) => {
  const device = await addDevice(page, "Replayed phone");
  await device.dialog.getByRole("button", { name: "Done" }).click();
  const batch = overlandBatch(account.timezone);

  // Without a (valid) token: 401 in Overland's own error format, which the app shows.
  const anonymous = await request.post("/api/overland", { data: batch });
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toEqual({ error: "Invalid access token" });
  expect(anonymous.headers()["www-authenticate"]).toContain("Bearer");
  const guessed = await postOverland(request, `trl_${"A".repeat(43)}`, batch);
  expect(guessed.status()).toBe(401);

  // The account probe Overland makes after setup.
  const probe = await request.get("/api/overland", {
    headers: { Authorization: `Bearer ${device.token}` },
  });
  expect(await probe.json()).toEqual({ name: "Replayed phone" });

  // Logging Mode "OwnTracks" sends one object; the error says what to change.
  const ownTracks = await postOverland(request, device.token, {
    _type: "location",
    lat: 51.0543,
    lon: 3.7174,
    tst: Math.floor(Date.now() / 1000),
    tid: "jp",
  });
  expect(ownTracks.status()).toBe(400);
  expect(await ownTracks.json()).toEqual({
    error:
      'Expected Overland JSON with a "locations" array. In Overland set Logging Mode to “All Data”.',
  });

  // The batch (with the phone's current position and a trip in progress), then once more:
  // Overland resends whatever it got no answer for.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await postOverland(request, device.token, batch);
    expect(await response.json()).toEqual({ result: "ok" });
  }
  await page.goto("/");
  const card = deviceCard(page, "Replayed phone");
  await expect(card.getByText("Live", { exact: true })).toBeVisible();
  await expect(card.getByText("Trip in progress")).toBeVisible();
  // The newest position is the payload's `current`, which is not stored as a point.
  await expect(fact(card, "Last position")).toContainText("50.9851° N, 3.5309° E");

  // An old app's timestamp, and records that cannot be stored: the batch is still accepted.
  const legacyAt = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 1000) * 1000);
  const mixed = await postOverland(request, device.token, {
    locations: [
      point(legacyTimestamp(legacyAt)),
      point(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), [0, 0]),
      point("half past eight"),
      "not a record",
    ],
  });
  expect(await mixed.json()).toEqual({ result: "ok" });

  const stored = locationsPageSchema.parse(
    await (
      await page.request.get("/api/locations", { params: { deviceId: device.id, limit: 100 } })
    ).json(),
  );
  expect(stored.items).toHaveLength(31);
  expect(stored.items.map((item) => item.recordedAt)).toContain(legacyAt.toISOString());

  await page.goto(`/devices/${device.id}`);
  const rows = page.getByRole("table", { name: "Uploads of this device" }).getByRole("row");
  await expect(rows).toHaveCount(4);
  const counts = async (index: number) =>
    (await rows.nth(index).getByRole("cell").allInnerTexts()).slice(1, 8);
  // records, new points, already stored, visits, trips, events, rejected
  expect(await counts(1)).toEqual(["4", "1", "0", "0", "0", "0", "3"]);
  expect(await counts(2)).toEqual(["34", "0", "30", "0", "0", "0", "0"]);
  expect(await counts(3)).toEqual(["34", "30", "0", "1", "1", "2", "0"]);

  // The last upload carried no trip: the phone is no longer on one.
  await page.goto("/");
  await expect(card.getByText("Trip in progress")).toBeHidden();
  await expect(fact(card, "Last position")).toContainText("50.9851° N, 3.5309° E");
});
