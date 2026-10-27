import { me } from "../map/me";

/**
 * Whom the map shows after "Show on map" on someone's card: that person alone
 * — the page then offers what it can show of them — unless they are on the
 * map already, when only the camera moves (null: the selection stays).
 */
export function selectionShowing(
  selected: readonly string[],
  key: string,
): readonly string[] | null {
  return selected.includes(key) ? null : [key];
}

/**
 * "Show everyone" (`everyone`: Me and all who share, in the selector's order)
 * and back: with everyone on the map already it returns to the start, the
 * signed-in person alone, like the selector's Everyone checkbox.
 */
export function everyoneToggled(
  selected: readonly string[],
  everyone: readonly string[],
): readonly string[] {
  return everyone.every((key) => selected.includes(key)) ? [me] : everyone;
}
