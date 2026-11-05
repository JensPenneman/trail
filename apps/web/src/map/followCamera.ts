/** What the camera keeps clear at each side, in px: a fit's padding with what floats over the map. */
export interface FramePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The padding a fit leaves (12 % of the shorter side, 24 to 72 px) with the insets of the floating controls. */
export function framePaddingOf(
  width: number,
  height: number,
  inset: { top?: number; right?: number } = {},
): FramePadding {
  const base = Math.max(24, Math.min(Math.round(Math.min(width, height) * 0.12), 72));
  return {
    top: base + (inset.top ?? 0),
    right: base + (inset.right ?? 0),
    bottom: base,
    left: base,
  };
}

/** Whether a point (screen px) is outside the viewport less `margin`. */
export function outsideFrame(
  point: { x: number; y: number },
  width: number,
  height: number,
  margin: FramePadding,
): boolean {
  return (
    point.x < margin.left ||
    point.x > width - margin.right ||
    point.y < margin.top ||
    point.y > height - margin.bottom
  );
}

/** How often the follow may move the camera. */
export const followEveryMs = 500;
/** How long the camera is left to the person after a gesture of theirs. */
export const gestureQuietMs = 5000;

/** Whether the follow may move the camera now: not too soon after its last move, nor while the camera is busy. */
export function followDue(now: number, lastFollowAt: number, busyUntil: number): boolean {
  return now - lastFollowAt >= followEveryMs && now >= busyUntil;
}
