import { type HeatMeasure, heatMeasures } from "@trail/contracts/heatmap";
import { startTransition, useCallback, useContext, useMemo, useOptimistic } from "react";
import { useSearchParams } from "react-router";
import { SessionUserContext } from "../../../app/SessionUserContext";

const storageKey = "trail.heat";
/** Without a choice in the address, remembered or preferred, Heat counts the points recorded. */
const defaultHeat: HeatMeasure = "points";

const isMeasure = (value: string | null): value is HeatMeasure =>
  value !== null && (heatMeasures as readonly string[]).includes(value);

function remembered(): HeatMeasure | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return isMeasure(value) ? value : null;
  } catch {
    return null;
  }
}

/** This browser follows the account's preference again (Settings › Preferences saved one). */
export function forgetHeatChoice(): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Private browsing: nothing was remembered.
  }
}

/** `?heat=` › the choice remembered on this browser › the account's preference › points. */
export function resolveHeatMeasure(
  fromUrl: string | null,
  rememberedHeat: HeatMeasure | null,
  preferred: HeatMeasure | undefined,
): HeatMeasure {
  if (isMeasure(fromUrl)) return fromUrl;
  return rememberedHeat ?? preferred ?? defaultHeat;
}

/**
 * What Heat counts (docs/architecture.md §14): `?heat=` in the address, so that links and Back
 * keep it; otherwise the choice last made on this browser; otherwise the account's preference;
 * otherwise the points recorded. Choosing replaces the entry, as the level does, and is remembered.
 */
export function useHeatChoice(): { heat: HeatMeasure; setHeat: (heat: HeatMeasure) => void } {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("heat");
  const preferred = useContext(SessionUserContext)?.preferences.heat;
  const heat = useMemo(
    () => resolveHeatMeasure(fromUrl, remembered(), preferred),
    [fromUrl, preferred],
  );
  // The router applies the new URL in a transition; until then the control shows the choice made.
  const [shown, show] = useOptimistic(heat);
  const setHeat = useCallback(
    (next: HeatMeasure) => {
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
            updated.set("heat", next);
            return updated;
          },
          { replace: true, preventScrollReset: true },
        );
      });
    },
    [setParams, show],
  );
  return { heat: shown, setHeat };
}
