import type { Rect } from "./chartTypes";

export type TooltipSide = "top" | "right" | "bottom" | "left";

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max));

/**
 * Where a tooltip of `size` goes next to `anchor` (the mark it belongs to)
 * inside a box of `bounds`: the first of `sides` where it fits whole. Beside
 * the mark its top lines up with `level` (the mark's top unless given),
 * above or below it is centred on the mark. Where it fits nowhere — a small
 * plot on a phone — it goes above or below the mark, whichever leaves less
 * of it outside the box: past the box's top or bottom for a moment, but
 * never over the mark itself, nor past the box's sides, where it would make
 * the page scroll sideways.
 */
export function placeTooltip(
  anchor: Rect,
  size: { width: number; height: number },
  bounds: { width: number; height: number },
  sides: readonly TooltipSide[],
  options: { gap?: number; level?: number } = {},
): { left: number; top: number } {
  const gap = options.gap ?? 8;
  const maxLeft = bounds.width - size.width;
  const maxTop = bounds.height - size.height;
  const level = clamp(options.level ?? anchor.y, maxTop);
  const centred = clamp(anchor.x + anchor.width / 2 - size.width / 2, maxLeft);
  const spots: Record<TooltipSide, { left: number; top: number }> = {
    right: { left: anchor.x + anchor.width + gap, top: level },
    left: { left: anchor.x - gap - size.width, top: level },
    top: { left: centred, top: anchor.y - gap - size.height },
    bottom: { left: centred, top: anchor.y + anchor.height + gap },
  };
  for (const side of sides) {
    const spot = spots[side];
    if (spot.left >= 0 && spot.left <= maxLeft && spot.top >= 0 && spot.top <= maxTop) return spot;
  }
  const outAbove = -spots.top.top;
  const outBelow = spots.bottom.top - maxTop;
  return outAbove <= outBelow ? spots.top : spots.bottom;
}
