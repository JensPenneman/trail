import { describe, expect, it } from "vitest";
import { allowedDeviceIds, mayReach } from "../../src/devices/deviceAccess";

const user = { id: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60" };
const phone = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
const watch = "0199a0f4-1a2b-7c3d-8e4f-5a6b7c8d9e0f";

describe("device access", () => {
  it("reaches every device without a list, and only the listed ones with one", () => {
    expect(allowedDeviceIds({ user })).toBeNull();
    expect(mayReach({ user }, watch)).toBe(true);
    expect(mayReach({ user, deviceIds: null }, watch)).toBe(true);
    expect(mayReach({ user, deviceIds: [phone] }, phone)).toBe(true);
    expect(mayReach({ user, deviceIds: [phone] }, watch)).toBe(false);
  });

  it("reaches no device with an empty list, never every one", () => {
    expect(allowedDeviceIds({ user, deviceIds: [] })).toEqual([]);
    expect(mayReach({ user, deviceIds: [] }, phone)).toBe(false);
  });

  it("compares ids without regard to case, as PostgreSQL does", () => {
    expect(mayReach({ user, deviceIds: [phone] }, phone.toUpperCase())).toBe(true);
    expect(mayReach({ user, deviceIds: [phone] }, watch.toUpperCase())).toBe(false);
  });
});
