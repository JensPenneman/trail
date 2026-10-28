import type { CacheStamp } from "@trail/contracts/cacheStamp";
import { describe, expect, it } from "vitest";
import { stampPlace, stampsMatch } from "../src/cache/stampsMatch";
import { dayStamp, ids } from "./support/fixtures";

const date = "2026-10-26";
const rows = (...stamps: { deviceId: string; raw: string; processed: string | null }[]) =>
  new Map<string, CacheStamp | undefined>(
    stamps.map((stamp) => [
      stampPlace(stamp.deviceId, date),
      { raw: stamp.raw, processed: stamp.processed },
    ]),
  );

describe("stampsMatch", () => {
  it("compares the raw stamp for the answers of recorded data", () => {
    const answer = [dayStamp(ids.phone, date, "r1", "p1")];
    expect(
      stampsMatch(answer, rows({ deviceId: ids.phone, raw: "r1", processed: "p2" }), "raw"),
    ).toBe(true);
    expect(
      stampsMatch(answer, rows({ deviceId: ids.phone, raw: "r2", processed: "p1" }), "raw"),
    ).toBe(false);
  });

  it("compares raw and processed for levels, the timeline and Insights", () => {
    const answer = [dayStamp(ids.phone, date, "r1", "p1")];
    expect(
      stampsMatch(answer, rows({ deviceId: ids.phone, raw: "r1", processed: "p1" }), "both"),
    ).toBe(true);
    expect(
      stampsMatch(answer, rows({ deviceId: ids.phone, raw: "r1", processed: "p2" }), "both"),
    ).toBe(false);
  });

  it("never matches a null processed stamp, on either side", () => {
    expect(
      stampsMatch(
        [dayStamp(ids.phone, date, "r1", null)],
        rows({ deviceId: ids.phone, raw: "r1", processed: null }),
        "both",
      ),
    ).toBe(false);
    expect(
      stampsMatch(
        [dayStamp(ids.phone, date, "r1", "p1")],
        rows({ deviceId: ids.phone, raw: "r1", processed: null }),
        "both",
      ),
    ).toBe(false);
  });

  it("never matches a missing digest row, a row without a stamp, or a row the answer lacks", () => {
    const answer = [dayStamp(ids.phone, date, "r1", "p1")];
    expect(stampsMatch(answer, new Map(), "raw")).toBe(false);
    expect(stampsMatch(answer, new Map([[stampPlace(ids.phone, date), undefined]]), "raw")).toBe(
      false,
    );
    // The car recorded the day since the answer: the digest has a row the answer has no stamp for.
    expect(
      stampsMatch(
        answer,
        rows(
          { deviceId: ids.phone, raw: "r1", processed: "p1" },
          { deviceId: ids.car, raw: "c1", processed: "q1" },
        ),
        "raw",
      ),
    ).toBe(false);
    expect(stampsMatch([], new Map(), "raw")).toBe(false);
  });

  it("needs every device of the answer to match", () => {
    const answer = [dayStamp(ids.phone, date, "r1", "p1"), dayStamp(ids.car, date, "c1", "q1")];
    expect(
      stampsMatch(
        answer,
        rows(
          { deviceId: ids.phone, raw: "r1", processed: "p1" },
          { deviceId: ids.car, raw: "c1", processed: "q1" },
        ),
        "both",
      ),
    ).toBe(true);
    expect(
      stampsMatch(
        answer,
        rows(
          { deviceId: ids.phone, raw: "r1", processed: "p1" },
          { deviceId: ids.car, raw: "c2", processed: "q1" },
        ),
        "both",
      ),
    ).toBe(false);
  });
});
