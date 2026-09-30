import type { IngestLogEntry } from "@trail/contracts/ingestLog";
import { describe, expect, it } from "vitest";
import { mergeUploadFeed } from "../src/live/mergeUploadFeed";
import { ids } from "./support/fixtures";

const entry = (id: string, receivedAt: string, locations: number): IngestLogEntry => ({
  id,
  receivedAt,
  records: locations,
  locations,
  duplicates: 0,
  visits: 0,
  trips: 0,
  events: 0,
  rejected: 0,
  durationMs: 20,
  userAgent: null,
});

describe("mergeUploadFeed", () => {
  it("combines device logs and live uploads, newest first, without doubles", () => {
    const logs = [
      {
        deviceId: ids.phone,
        entries: [
          entry("2", "2026-09-30T10:05:01.000Z", 40),
          entry("1", "2026-09-30T10:00:00.000Z", 12),
        ],
      },
      { deviceId: ids.car, entries: [entry("9", "2026-09-30T09:00:00.000Z", 8)] },
    ];
    const live = [
      // The same upload as log entry 2, announced a moment earlier.
      {
        deviceId: ids.phone,
        receivedAt: "2026-09-30T10:05:00.000Z",
        inserted: 40,
        duplicates: 0,
        rejected: 0,
      },
      // Not in the log yet.
      {
        deviceId: ids.phone,
        receivedAt: "2026-09-30T10:10:00.000Z",
        inserted: 5,
        duplicates: 1,
        rejected: 0,
      },
    ];
    const feed = mergeUploadFeed(logs, live, 10);
    expect(feed.map((item) => [item.receivedAt, item.live])).toEqual([
      ["2026-09-30T10:10:00.000Z", true],
      ["2026-09-30T10:05:01.000Z", true],
      ["2026-09-30T10:00:00.000Z", false],
      ["2026-09-30T09:00:00.000Z", false],
    ]);
    expect(mergeUploadFeed(logs, live, 2)).toHaveLength(2);
  });
});
