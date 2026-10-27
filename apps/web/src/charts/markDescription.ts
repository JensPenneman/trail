import type { TooltipContent } from "./chartTypes";

/** A mark's values in words, for its accessible description: "Car 12.3 km, Train 30 km, total 42.3 km". */
export function markDescription(content: TooltipContent): string {
  const parts = content.entries.map((entry) =>
    content.keyed ? `${entry.label} ${entry.value}` : entry.value,
  );
  if (content.total !== undefined) {
    parts.push(parts.length === 0 ? `Total ${content.total}` : `total ${content.total}`);
  }
  return parts.join(", ");
}
