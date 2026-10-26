import { personPaletteSize } from "./personPalette";

/**
 * Palette slot per person, in the order they started sharing: whoever shared
 * first keeps the first colour, and hiding or adding someone never repaints
 * the people who stay before them.
 */
export function assignPersonColors(
  people: readonly { userId: string; share: { createdAt: string } }[],
): ReadonlyMap<string, number> {
  const ordered = [...people].sort(
    (a, b) =>
      Date.parse(a.share.createdAt) - Date.parse(b.share.createdAt) ||
      a.userId.localeCompare(b.userId),
  );
  return new Map(ordered.map((person, index) => [person.userId, index % personPaletteSize]));
}
