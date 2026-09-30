import { describe, expect, it } from "vitest";
import { parseOverlandTimestamp } from "../../src/overland/parseOverlandTimestamp";

const iso = (value: unknown) => parseOverlandTimestamp(value)?.toISOString() ?? null;

describe("parseOverlandTimestamp", () => {
  it("parses the current Overland format", () => {
    expect(iso("2026-09-30T07:15:30Z")).toBe("2026-09-30T07:15:30.000Z");
  });

  it("parses legacy offsets without a colon", () => {
    expect(iso("2015-10-01T08:00:00-0700")).toBe("2015-10-01T15:00:00.000Z");
    expect(iso("2015-10-01T08:00:00+0530")).toBe("2015-10-01T02:30:00.000Z");
  });

  it("parses offsets with a colon and fractional seconds", () => {
    expect(iso("2026-09-30T09:15:30+02:00")).toBe("2026-09-30T07:15:30.000Z");
    expect(iso("2026-09-30T07:15:30.123456Z")).toBe("2026-09-30T07:15:30.123Z");
    expect(iso("2026-09-30T07:15:30.5Z")).toBe("2026-09-30T07:15:30.500Z");
  });

  it("keeps years literally (no two-digit year mapping)", () => {
    expect(iso("0026-01-01T00:00:00Z")).toBe("0026-01-01T00:00:00.000Z");
  });

  it("rejects everything else", () => {
    for (const value of [
      "2026-09-30 07:15:30Z",
      "2026-09-30T07:15:30",
      "2026-09-30T07:15Z",
      "2026-09-30T07:15:30+02",
      "2026-13-01T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-09-30T24:00:00Z",
      "2026-09-30T07:60:00Z",
      "2026-09-30T07:15:30+24:00",
      "1727680530",
      "",
      1_727_680_530,
      null,
      undefined,
    ]) {
      expect(parseOverlandTimestamp(value), String(value)).toBeNull();
    }
  });
});
