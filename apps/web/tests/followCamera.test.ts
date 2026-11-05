import { describe, expect, it } from "vitest";
import {
  followDue,
  followEveryMs,
  framePaddingOf,
  gestureQuietMs,
  outsideFrame,
} from "../src/map/followCamera";

describe("the camera following a cursor", () => {
  it("keeps the margin of a fit, capped at 72 px, with the room the floating controls take", () => {
    expect(framePaddingOf(1000, 800)).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
    expect(framePaddingOf(320, 400)).toEqual({ top: 38, right: 38, bottom: 38, left: 38 });
    expect(framePaddingOf(200, 200, { top: 60, right: 50 })).toEqual({
      top: 84,
      right: 74,
      bottom: 24,
      left: 24,
    });
  });

  it("finds a point outside the viewport less that margin, so a framed cursor stays", () => {
    const margin = framePaddingOf(1000, 800, { top: 56 });
    expect(outsideFrame({ x: 500, y: 400 }, 1000, 800, margin)).toBe(false);
    // On the edge of a freshly framed day (the fit's own padding): inside, no ease undoes the frame.
    expect(outsideFrame({ x: 72, y: 128 }, 1000, 800, margin)).toBe(false);
    expect(outsideFrame({ x: 60, y: 400 }, 1000, 800, margin)).toBe(true);
    // Under the controls at the top.
    expect(outsideFrame({ x: 500, y: 100 }, 1000, 800, margin)).toBe(true);
  });

  it("moves at most twice a second, and not after a gesture or during a fit", () => {
    expect(followDue(10_000, 10_000 - followEveryMs, 0)).toBe(true);
    expect(followDue(10_000, 10_000 - followEveryMs + 1, 0)).toBe(false);
    // The person's gesture at 10 s: left alone for the quiet time.
    const busyUntil = 10_000 + gestureQuietMs;
    expect(followDue(10_000 + gestureQuietMs - 1, 0, busyUntil)).toBe(false);
    expect(followDue(10_000 + gestureQuietMs, 0, busyUntil)).toBe(true);
  });
});
