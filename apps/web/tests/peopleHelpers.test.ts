import type { TransportMode } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../src/format/createFormatter";
import { assignPersonColors } from "../src/people/assignPersonColors";
import { describeActivity } from "../src/people/describeActivity";
import { appleMapsUrl, googleMapsUrl } from "../src/people/mapLinks";
import { personInitials } from "../src/people/personInitials";
import { primaryDevice } from "../src/people/primaryDevice";
import { devicesText, expiryText, historyText } from "../src/sharing/shareText";
import { sharedDevice } from "./support/fixtures";

const format = createFormatter("en-GB", "Europe/Brussels");
const at = (speed: number | null) =>
  ({ ...(sharedDevice().location ?? { lat: 0, lon: 0 }), speed }) as never;

describe("people helpers", () => {
  it("give people colours in the order they started sharing", () => {
    const slots = assignPersonColors([
      { userId: "b", share: { createdAt: "2026-10-22T00:00:00Z" } },
      { userId: "a", share: { createdAt: "2026-10-20T00:00:00Z" } },
      { userId: "c", share: { createdAt: "2026-10-20T00:00:00Z" } },
    ]);
    expect([...slots]).toEqual([
      ["a", 0],
      ["c", 1],
      ["b", 2],
    ]);
  });

  it("make initials of one or two letters", () => {
    expect(personInitials("Ana Bell")).toBe("AB");
    expect(personInitials("jens")).toBe("J");
    expect(personInitials("jean-luc picard")).toBe("JP");
    expect(personInitials("  ")).toBe("?");
    expect(personInitials("Émile Zola")).toBe("ÉZ");
  });

  it("link to Apple Maps and Google Maps", () => {
    expect(appleMapsUrl(51.05, 3.71, "Ana & Bo")).toBe(
      "https://maps.apple.com/?ll=51.05%2C3.71&q=Ana+%26+Bo",
    );
    expect(googleMapsUrl(51.05, 3.71)).toBe(
      "https://www.google.com/maps/search/?api=1&query=51.05%2C3.71",
    );
  });

  it("describe what someone is doing with whatever the share includes", () => {
    const activity = (mode: TransportMode | null, tripMode: string | null, motion: string[]) => ({
      mode,
      tripMode,
      motion,
    });
    expect(describeActivity(at(12), activity("train", null, ["automotive"]), format)).toBe(
      "43 km/h · by train",
    );
    expect(describeActivity(at(4), activity(null, "bicycle", ["cycling"]), format)).toBe(
      "14 km/h · on a bike ride",
    );
    expect(describeActivity(at(0), activity(null, null, ["walking"]), format)).toBe("Walking");
    expect(describeActivity(at(0), activity("stationary", null, []), format)).toBe(
      "Standing still",
    );
    expect(describeActivity(at(3), null, format)).toBe("11 km/h");
    expect(describeActivity(at(null), null, format)).toBeNull();
    expect(describeActivity(null, null, format)).toBeNull();
    expect(describeActivity(at(2), activity("unknown", null, []), format)).toBe("7 km/h");
  });

  it("take motions and trip modes named like every object's properties for unknown ones", () => {
    const activity = (tripMode: string | null, motion: string[]) => ({
      mode: null,
      tripMode,
      motion,
    });
    expect(describeActivity(at(0), activity(null, ["constructor", "__proto__"]), format)).toBe(
      "Standing still",
    );
    expect(describeActivity(at(0), activity(null, ["__proto__", "walking"]), format)).toBe(
      "Walking",
    );
    expect(describeActivity(at(0), activity("constructor", []), format)).toBe("On a constructor");
  });

  it("pick the device that reported last", () => {
    const old = sharedDevice({ id: "old" });
    const location = sharedDevice().location;
    if (location === null) throw new Error("fixture without location");
    const fresh = sharedDevice({
      id: "fresh",
      location: { ...location, recordedAt: new Date().toISOString() },
    });
    const none = sharedDevice({ id: "none", location: null });
    expect(primaryDevice([old, fresh, none])?.id).toBe("fresh");
    expect(primaryDevice([none])?.id).toBe("none");
    expect(primaryDevice([])).toBeNull();
  });

  it("put shares into words", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    expect(expiryText(null, format, now)).toBe("Until stopped");
    expect(expiryText("2026-10-26T22:59:00Z", format, now)).toBe("Until 23:59");
    expect(expiryText("2026-10-27T09:00:00Z", format, now)).toMatch(/^Until Tue 27 Oct, 10:00$/);
    expect(expiryText("2026-10-26T09:00:00Z", format, now)).toBe("Ended");
    expect(historyText(null)).toBe("Live only");
    expect(historyText(1)).toBe("Last 24 hours");
    expect(historyText(7)).toBe("Last 7 days");
    const devices = [
      { id: "p", name: "Phone" },
      { id: "w", name: "Watch" },
    ];
    expect(devicesText(null, devices, format)).toBe("All devices");
    expect(devicesText([], devices, format)).toBe("No devices");
    expect(devicesText(["w", "p"], devices, format)).toBe("Phone and Watch");
  });
});
