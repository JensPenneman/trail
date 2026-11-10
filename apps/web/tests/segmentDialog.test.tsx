import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Segment } from "@trail/contracts/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { SegmentDialog } from "../src/transport/SegmentDialog";
import { ids, timeline } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { createTestQueryClient, renderPage } from "./support/renderPage";

const now = new Date("2026-10-27T11:00:00.000Z");

/** The train ride, ended `endedAgoS` seconds ago and corrected by the person. */
function ride(endedAgoS: number): Segment {
  const move = timeline("2026-10-27T00:00:00.000Z").find((segment) => segment.kind === "move");
  if (move === undefined) throw new Error("the fixture has no move");
  const endedAt = new Date(now.getTime() - endedAgoS * 1000);
  return {
    ...move,
    modeUser: "bus",
    endedAt: endedAt.toISOString(),
    startedAt: new Date(endedAt.getTime() - move.durationS * 1000).toISOString(),
  };
}

/** Renders the dialog alone, with the day's timeline in the cache as the map's view holds it. */
function show(segment: Segment, ...after: Segment[]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    queryKeys.timeline({
      from: "2026-10-27T00:00:00.000Z",
      to: "2026-10-28T00:00:00.000Z",
      deviceIds: null,
    }),
    { items: [segment, ...after], pending: false },
  );
  return renderPage(
    <SegmentDialog segment={segment} deviceName="iPhone 16" onClose={() => undefined} />,
    { queryClient },
  );
}

const picker = () => screen.queryByRole("group", { name: "Change mode" });

describe("SegmentDialog and a move that is still going on", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says it is still under way instead of the picker, the question and Reset", () => {
    const api = mockApi({});
    show(ride(60));
    expect(screen.getByText("Still under way")).toBeInTheDocument();
    expect(screen.getByText(/can be set or reset once this move is over/)).toBeInTheDocument();
    expect(picker()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Yes,/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset to detected" })).not.toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("offers the picker and Reset once a later segment of the device is there", () => {
    const move = ride(60);
    const stop: Segment = { ...move, id: ids.stop, kind: "stop", startedAt: move.endedAt };
    show(move, stop);
    expect(picker()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset to detected" })).toBeEnabled();
    expect(screen.queryByText("Still under way")).not.toBeInTheDocument();
  });

  it("offers the picker for a move that ended long ago", () => {
    show(ride(31 * 60));
    expect(picker()).toBeEnabled();
    expect(screen.queryByText("Still under way")).not.toBeInTheDocument();
  });

  it("turns into the picker when the silence reaches thirty minutes", () => {
    show(ride(29 * 60));
    expect(screen.getByText("Still under way")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(screen.queryByText("Still under way")).not.toBeInTheDocument();
    expect(picker()).toBeEnabled();
  });

  it("says a correction is still waiting for processing, beside a retry that saves it", async () => {
    const move = ride(31 * 60);
    let calls = 0;
    mockApi({
      [`DELETE /api/v1/segments/${move.id}/mode`]: () => {
        calls += 1;
        return calls === 1
          ? {
              status: 409,
              body: {
                error: {
                  code: "conflict",
                  message: "Still processing this device's data, try again in a moment.",
                },
              },
            }
          : {
              status: 200,
              body: { segment: { ...move, modeUser: null, mode: move.modeInferred } },
            };
      },
    });
    show(move);
    // The fake clock leaves timers alone, so the click and the answer run on real ones.
    const person = userEvent.setup({ advanceTimers: () => undefined });
    await person.click(screen.getByRole("button", { name: "Reset to detected" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Still processing this device's data, try again in a moment.",
    );
    await person.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^Back to the detected mode/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The button went with the failure: the focus is on the answer, not lost to the page.
    await waitFor(() => expect(screen.getByText(/^Back to the detected mode/)).toHaveFocus());
    expect(calls).toBe(2);
  });
});

describe("SegmentDialog and a train drawn along the railway", () => {
  const line = "Drawn along the railway. The Mapped level shows it as recorded.";
  const aligned = (): Segment => ({ ...ride(31 * 60), modeUser: null, alignedTo: "rail" });

  it("says so for a move aligned to the rails, as one visible line", () => {
    show(aligned());
    expect(screen.getByText(line)).toBeVisible();
    // The accessible name of the picker and the dialog's controls are untouched by the line.
    expect(picker()).toBeEnabled();
  });

  it("says nothing for a move drawn as recorded", () => {
    show({ ...aligned(), alignedTo: null });
    expect(screen.queryByText(/Drawn along the railway/)).not.toBeInTheDocument();
  });

  it("says nothing for a stop", () => {
    const stop: Segment = { ...aligned(), kind: "stop", mode: null, alignedTo: "rail" };
    show(stop);
    expect(screen.queryByText(/Drawn along the railway/)).not.toBeInTheDocument();
  });

  it("keeps the line before the controls and out of the tab order", async () => {
    show(aligned());
    const person = userEvent.setup({ advanceTimers: () => undefined });
    await person.tab();
    expect(screen.getByText(line)).not.toHaveFocus();
    expect(document.activeElement?.tagName).not.toBe("P");
  });
});
