import { describe, expect, it } from "vitest";
import { parseServerEvent } from "../src/live/parseServerEvent";
import { device, ids } from "./support/fixtures";

describe("parseServerEvent", () => {
  it("accepts events of the contract", () => {
    expect(
      parseServerEvent(JSON.stringify({ type: "hello", serverTime: "2026-09-30T10:00:00.000Z" })),
    ).toEqual({
      type: "hello",
      serverTime: "2026-09-30T10:00:00.000Z",
    });
    expect(parseServerEvent(JSON.stringify({ type: "device", device: device() }))?.type).toBe(
      "device",
    );
    expect(
      parseServerEvent(JSON.stringify({ type: "device-removed", deviceId: ids.car }))?.type,
    ).toBe("device-removed");
  });

  it("ignores anything else instead of throwing", () => {
    expect(parseServerEvent("not json")).toBeNull();
    expect(parseServerEvent(JSON.stringify({ type: "surprise" }))).toBeNull();
    expect(parseServerEvent(undefined)).toBeNull();
  });
});
