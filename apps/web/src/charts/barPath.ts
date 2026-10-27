import type { Rect } from "./chartTypes";

const r2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The outline of a bar whose data end — `top` for a column, `right` for a
 * horizontal bar — has rounded corners (4 px, less on a thin bar), while the
 * end on the baseline stays square; `none` is a plain box (a segment inside a
 * stack).
 */
export function barPath(rect: Rect, end: "top" | "right" | "none", radius = 4): string {
  const x = r2(rect.x);
  const y = r2(rect.y);
  const w = r2(Math.max(0, rect.width));
  const h = r2(Math.max(0, rect.height));
  if (end === "top") {
    const r = r2(Math.max(0, Math.min(radius, w / 2, h)));
    return `M${x} ${r2(y + h)}V${r2(y + r)}A${r} ${r} 0 0 1 ${r2(x + r)} ${y}H${r2(x + w - r)}A${r} ${r} 0 0 1 ${r2(x + w)} ${r2(y + r)}V${r2(y + h)}Z`;
  }
  if (end === "right") {
    const r = r2(Math.max(0, Math.min(radius, h / 2, w)));
    return `M${x} ${y}H${r2(x + w - r)}A${r} ${r} 0 0 1 ${r2(x + w)} ${r2(y + r)}V${r2(y + h - r)}A${r} ${r} 0 0 1 ${r2(x + w - r)} ${r2(y + h)}H${x}Z`;
  }
  return `M${x} ${y}H${r2(x + w)}V${r2(y + h)}H${x}Z`;
}
