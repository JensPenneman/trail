import { describe, expect, it } from "vitest";
import { assignDeviceColors } from "../src/devices/assignDeviceColors";

describe("assignDeviceColors", () => {
  const devices = [
    { id: "c", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "a", createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "b", createdAt: "2026-04-01T00:00:00.000Z" },
  ];

  it("gives the oldest device the first colour", () => {
    const slots = assignDeviceColors(devices);
    expect([slots.get("a"), slots.get("b"), slots.get("c")]).toEqual([0, 1, 2]);
  });

  it("does not depend on the order devices arrive in", () => {
    expect(assignDeviceColors([...devices].reverse())).toEqual(assignDeviceColors(devices));
  });
});
