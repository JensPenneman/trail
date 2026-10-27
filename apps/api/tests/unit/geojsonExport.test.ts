import { describe, expect, it } from "vitest";
import type { ExportDevice, ExportRow } from "../../src/export/exportRow";
import { geojsonFormatter } from "../../src/export/geojsonFormatter";

const device: ExportDevice = { id: "d1", name: "Pixel", deviceKey: "pixel-k3f9" };

const row = (overrides: Partial<ExportRow>): ExportRow => ({
  recorded_at: "2026-10-27 09:00:00+00",
  received_at: "2026-10-27 09:00:05+00",
  epoch: 1_793_091_600,
  lat: 51.0543,
  lon: 3.7174,
  altitude: null,
  speed: 4.2,
  course: null,
  horizontal_accuracy: 5,
  vertical_accuracy: null,
  speed_accuracy: null,
  course_accuracy: null,
  motion: [],
  battery_level: null,
  battery_state: null,
  wifi: null,
  extra: null,
  ...overrides,
});

const propertiesOf = (rows: readonly ExportRow[]) => {
  const formatter = geojsonFormatter();
  const text = formatter.begin() + formatter.rows(device, rows) + formatter.end();
  const collection = JSON.parse(text) as { features: { properties: Record<string, unknown> }[] };
  return collection.features.map((feature) => feature.properties);
};

describe("the GeoJSON export", () => {
  it("keeps what the phone sent under a column's name when that column is empty", () => {
    const [osmand, overland] = propertiesOf([
      // The OsmAnd format's `wifi` is an access point, kept in extra; the Wi-Fi column is empty.
      row({ extra: { wifi: "aa:bb:cc:dd:ee:ff,-61", sat: "9" } }),
      row({ wifi: "Home", extra: { wifi: "stale" } }),
    ]);
    expect(osmand).toMatchObject({ wifi: "aa:bb:cc:dd:ee:ff,-61", sat: "9", speed: 4.2 });
    expect(osmand).not.toHaveProperty("altitude");
    // A column with a value is what Trail recorded: it wins.
    expect(overland).toMatchObject({ wifi: "Home" });
  });

  it("never lets extra stand in for what every feature says about itself", () => {
    const [properties] = propertiesOf([
      row({ extra: { kind: "visit", device_id: "someone-else", timestamp: "yesterday" } }),
    ]);
    expect(properties).toMatchObject({
      kind: "location",
      device_id: "pixel-k3f9",
      timestamp: "2026-10-27T09:00:00.000Z",
    });
  });
});
