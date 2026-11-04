import type { PathColour } from "@trail/contracts/preferences";
import type { ProcessingLevel } from "@trail/contracts/transport";
import { startTransition, useCallback, useContext, useMemo, useOptimistic } from "react";
import { useSearchParams } from "react-router";
import { SessionUserContext } from "../app/SessionUserContext";
import {
  type PathColouring,
  parsePathColour,
  pathColoursFor,
  resolvePathColour,
} from "../map/pathColour/pathColours";

const storageKey = "trail.color";

function remembered(): PathColour | null {
  try {
    return parsePathColour(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

/** This browser follows the account's preference again (Settings › Preferences saved one). */
export function forgetPathColourChoice(): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Private browsing: nothing was remembered.
  }
}

/**
 * What the paths on the map are coloured by (docs/architecture.md §14): `?color=` in the address,
 * so that links and Back keep it; otherwise the choice last made on this browser; otherwise the
 * account's preference; otherwise the level's default. A choice the level does not support is
 * skipped, never rewritten. Choosing replaces the entry, as the level does, and is remembered.
 */
export function usePathColour(
  level: ProcessingLevel,
  context: { dark: boolean; timeZone: string },
): {
  colour: PathColour;
  options: readonly PathColour[];
  setColour: (colour: PathColour) => void;
  colouring: PathColouring;
} {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("color");
  const preferred = useContext(SessionUserContext)?.preferences.color;
  const colour = useMemo(
    () => resolvePathColour(level, [fromUrl, remembered(), preferred]),
    [level, fromUrl, preferred],
  );
  // The router applies the new URL in a transition; until then the control shows the choice made.
  const [shown, show] = useOptimistic(colour);
  const setColour = useCallback(
    (next: PathColour) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Private browsing: the address still carries the choice.
      }
      startTransition(() => {
        show(next);
        setParams(
          (current) => {
            const updated = new URLSearchParams(current);
            updated.set("color", next);
            return updated;
          },
          { replace: true, preventScrollReset: true },
        );
      });
    },
    [setParams, show],
  );
  const colouring = useMemo<PathColouring>(
    () => ({ by: shown, dark: context.dark, timeZone: context.timeZone }),
    [shown, context.dark, context.timeZone],
  );
  return { colour: shown, options: pathColoursFor(level), setColour, colouring };
}
