import { describe, expect, it } from "vitest";
import { expiryInstant } from "../src/pages/settings/tokenExpiry";

describe("token expiry", () => {
  const now = Date.parse("2026-10-26T09:15:00.000Z");
  const input = { now, date: "2026-12-31", timeZone: "Europe/Brussels" };

  it("counts days from now", () => {
    expect(expiryInstant("30-days", input)).toBe("2026-11-25T09:15:00.000Z");
    expect(expiryInstant("90-days", input)).toBe("2027-01-24T09:15:00.000Z");
    expect(expiryInstant("1-year", input)).toBe("2027-10-26T09:15:00.000Z");
  });

  it("lets a chosen day work to its end, in the account's time zone", () => {
    expect(expiryInstant("date", input)).toBe("2026-12-31T22:59:59.999Z");
    // Summer time: midnight in Brussels is 22:00 UTC.
    expect(expiryInstant("date", { ...input, date: "2027-07-14" })).toBe(
      "2027-07-14T21:59:59.999Z",
    );
    expect(expiryInstant("date", { ...input, timeZone: "America/New_York" })).toBe(
      "2027-01-01T04:59:59.999Z",
    );
  });

  it("has no instant for a token that never expires", () => {
    expect(expiryInstant("never", input)).toBeNull();
  });
});
