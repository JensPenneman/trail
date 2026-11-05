import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { type HeatmapParams, queryKeys } from "../src/api/queryKeys";
import { applyServerEvent } from "../src/live/applyServerEvent";
import { createLiveStore } from "../src/live/createLiveStore";
import { resyncAfterGap } from "../src/live/resyncAfterGap";
import { invalidateStopHeat, staleProcessed } from "../src/live/staleProcessed";
import { pendingRetryMs, sameHeatKind } from "../src/queries/useHeatmap";

const params = (overrides: Partial<HeatmapParams> = {}): HeatmapParams => ({
  bbox: "3.5,50.9,4,51.3",
  zoom: 12,
  deviceIds: null,
  heat: "points",
  mode: null,
  from: null,
  to: null,
  ...overrides,
});

function filled() {
  const client = new QueryClient();
  const kinds = {
    points: params(),
    time: params({ heat: "time", from: "2026-10-01", to: "2026-10-31" }),
    visits: params({ heat: "visits" }),
  };
  for (const kind of Object.values(kinds))
    client.setQueryData(queryKeys.heatmap(kind), { cells: [] });
  const invalidated = (kind: keyof typeof kinds) =>
    client.getQueryState(queryKeys.heatmap(kinds[kind]))?.isInvalidated === true;
  return { client, invalidated };
}

describe("the heat of stops", () => {
  it("goes stale when processing changes a stretch, the heat of points does not", () => {
    const { client, invalidated } = filled();
    staleProcessed(
      client,
      { deviceId: "d", from: "2026-10-20T00:00:00Z", to: "2026-10-21T00:00:00Z" },
      "event",
    );
    expect(invalidated("time")).toBe(true);
    expect(invalidated("visits")).toBe(true);
    expect(invalidated("points")).toBe(false);
  });

  it("goes stale only for the devices and days a change touches", () => {
    const client = new QueryClient();
    const kinds = {
      october: params({ heat: "time", from: "2026-10-01", to: "2026-10-31" }),
      september: params({ heat: "time", from: "2026-09-01", to: "2026-09-30" }),
      allTime: params({ heat: "visits" }),
      other: params({ heat: "time", from: "2026-10-01", to: "2026-10-31", deviceIds: ["b"] }),
      mine: params({ heat: "time", from: "2026-10-01", to: "2026-10-31", deviceIds: ["a", "b"] }),
      points: params(),
    };
    for (const kind of Object.values(kinds)) client.setQueryData(queryKeys.heatmap(kind), {});
    const stale = (name: keyof typeof kinds) =>
      client.getQueryState(queryKeys.heatmap(kinds[name]))?.isInvalidated === true;
    // 20 October in Brussels, device a.
    void invalidateStopHeat(client, {
      deviceId: "a",
      from: "2026-10-20T08:00:00Z",
      to: "2026-10-20T10:00:00Z",
      timezone: "Europe/Brussels",
    });
    expect(stale("october")).toBe(true); // every device, that period
    expect(stale("allTime")).toBe(true); // no period: all history
    expect(stale("mine")).toBe(true);
    expect(stale("september")).toBe(false); // another period
    expect(stale("other")).toBe(false); // another device
    expect(stale("points")).toBe(false);
  });

  it("goes stale after a gap in the live stream too", () => {
    const { client, invalidated } = filled();
    resyncAfterGap(client);
    expect(invalidated("time")).toBe(true);
    expect(invalidated("visits")).toBe(true);
    expect(invalidated("points")).toBe(false);
  });
});

describe("the placeholder of a heat view", () => {
  it("is kept only for the same measure, period and devices", () => {
    const base = params({
      heat: "time",
      from: "2026-10-01",
      to: "2026-10-31",
      deviceIds: ["a", "b"],
    });
    // A pan changes the box and the zoom, nothing else.
    expect(sameHeatKind(params({ ...base, bbox: "1,2,3,4", zoom: 13 }), base)).toBe(true);
    expect(sameHeatKind({ ...base, heat: "visits" }, base)).toBe(false);
    expect(sameHeatKind({ ...base, from: "2026-09-01" }, base)).toBe(false);
    expect(sameHeatKind({ ...base, deviceIds: ["a"] }, base)).toBe(false);
    expect(sameHeatKind({ ...base, deviceIds: null }, { ...base, deviceIds: [] })).toBe(true);
    expect(sameHeatKind(undefined, base)).toBe(false);
    // A key from before the measure existed is no match.
    expect(sameHeatKind({ bbox: "x", zoom: 1, deviceIds: null }, params())).toBe(false);
  });
});

describe("asking again for an answer still being worked out", () => {
  it("is left to the stream while it is open, and backs off 10, 30, 60 s without one", () => {
    expect(pendingRetryMs(true, "open", 1)).toBe(false);
    expect(pendingRetryMs(false, "reconnecting", 1)).toBe(false);
    expect(pendingRetryMs(true, "connecting", 1)).toBe(10_000);
    expect(pendingRetryMs(true, "reconnecting", 2)).toBe(30_000);
    expect(pendingRetryMs(true, "reconnecting", 3)).toBe(60_000);
    expect(pendingRetryMs(true, "reconnecting", 40)).toBe(60_000);
  });

  it("goes stale with a segments event for the days of a movement answer", () => {
    const client = new QueryClient();
    const key = queryKeys.heatmap(params({ heat: "moving", from: "2026-11-01", to: "2026-11-30" }));
    client.setQueryData(key, { pending: true });
    void invalidateStopHeat(client, {
      deviceId: "d",
      from: "2026-11-05T00:00:00Z",
      to: "2026-11-06T00:00:00Z",
      timezone: "UTC",
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it("goes stale with a heat event, and the pass's other answers do not", () => {
    const client = new QueryClient();
    const heatKey = queryKeys.heatmap(params({ heat: "moving" }));
    const timelineKey = ["timeline", { from: "2026-11-05" }] as const;
    client.setQueryData(heatKey, { pending: true });
    client.setQueryData(timelineKey, { items: [] });
    applyServerEvent(client, createLiveStore(), {
      type: "heat",
      deviceId: "00000000-0000-4000-8000-000000000001",
      from: "2026-11-05T00:00:00.000Z",
      to: "2026-11-06T00:00:00.000Z",
    });
    expect(client.getQueryState(heatKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(timelineKey)?.isInvalidated).toBe(false);
  });
});
