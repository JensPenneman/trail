import { describe, expect, it } from "vitest";
import { decodeSegmentsNotice, encodeSegmentsNotice } from "../../src/events/processingNotify";

const notice = {
  userId: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
  deviceId: "0199a0f3-6011-7c2e-9d41-2f0be33c6a10",
  from: new Date("2026-10-28T06:30:00.000Z"),
  to: new Date("2026-10-28T08:15:30.500Z"),
};

describe("the processing channel's messages", () => {
  it("carry a finished window there and back", () => {
    const payload = encodeSegmentsNotice(notice);
    expect(JSON.parse(payload)).toEqual({
      t: "segments",
      u: notice.userId,
      d: notice.deviceId,
      from: "2026-10-28T06:30:00.000Z",
      to: "2026-10-28T08:15:30.500Z",
    });
    expect(decodeSegmentsNotice(payload)).toEqual(notice);
  });

  it("stay far under the 8000 bytes NOTIFY carries", () => {
    expect(Buffer.byteLength(encodeSegmentsNotice(notice))).toBeLessThan(200);
  });

  it("leave alone what is not a segments message of this version", () => {
    const valid = JSON.parse(encodeSegmentsNotice(notice)) as Record<string, unknown>;
    for (const payload of [
      "",
      "not json",
      "null",
      "[]",
      JSON.stringify({ ...valid, t: "remap" }),
      JSON.stringify({ ...valid, u: "someone" }),
      JSON.stringify({ ...valid, d: undefined }),
      JSON.stringify({ ...valid, from: "yesterday" }),
      JSON.stringify({ ...valid, to: 1_793_000_000 }),
    ]) {
      expect(decodeSegmentsNotice(payload)).toBeNull();
    }
  });
});
