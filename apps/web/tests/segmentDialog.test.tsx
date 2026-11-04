import { screen } from "@testing-library/react";
import type { DeviceMode, Segment } from "@trail/contracts/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentDialog } from "../src/transport/SegmentDialog";
import { automatic, ids, timeline } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";

const now = new Date("2026-10-27T11:00:00.000Z");
const modeOf = `GET /api/v1/devices/${ids.phone}/mode`;

/** The train ride, ended `endedAgoS` seconds ago. */
function ride(endedAgoS: number): Segment {
  const move = timeline("2026-10-27T00:00:00.000Z").find((segment) => segment.kind === "move");
  if (move === undefined) throw new Error("the fixture has no move");
  const endedAt = new Date(now.getTime() - endedAgoS * 1000);
  return {
    ...move,
    endedAt: endedAt.toISOString(),
    startedAt: new Date(endedAt.getTime() - move.durationS * 1000).toISOString(),
  };
}

const current = { mode: "train", setByUser: false, since: now.toISOString() } as const;
const going: DeviceMode = { override: null, current: { ...current, segmentId: ids.train } };

function show(segment: Segment) {
  renderPage(<SegmentDialog segment={segment} deviceName="iPhone 16" onClose={() => undefined} />);
}

describe("SegmentDialog and a move that is still going on", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says it is still under way instead of offering the picker", async () => {
    const api = mockApi({ [modeOf]: { status: 200, body: { mode: going } } });
    show(ride(60));
    expect(await screen.findByText("Still under way")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Change mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Yes,/ })).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.endsWith("/mode"))).toHaveLength(1);
  });

  it("offers the picker once the device is on another segment", async () => {
    const other: DeviceMode = { override: null, current: { ...current, segmentId: ids.stop } };
    mockApi({ [modeOf]: { status: 200, body: { mode: other } } });
    show(ride(60));
    expect(await screen.findByRole("group", { name: "Change mode" })).toBeEnabled();
    expect(screen.queryByText("Still under way")).not.toBeInTheDocument();
  });

  it("asks nothing for a move that ended ten minutes ago or earlier", async () => {
    const api = mockApi({ [modeOf]: { status: 200, body: { mode: automatic } } });
    show(ride(601));
    expect(await screen.findByRole("group", { name: "Change mode" })).toBeEnabled();
    expect(api.calls.filter((call) => call.path.endsWith("/mode"))).toHaveLength(0);
  });
});
