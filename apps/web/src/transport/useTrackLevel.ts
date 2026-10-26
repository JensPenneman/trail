import { type ProcessingLevel, processingLevels } from "@trail/contracts/transport";
import { startTransition, useCallback, useMemo, useOptimistic } from "react";
import { useSearchParams } from "react-router";

const storageKey = "trail.level";
/** Without a choice in the URL or remembered, the dashboard shows how you travelled. */
const defaultLevel: ProcessingLevel = "inferred";

const isLevel = (value: string | null): value is ProcessingLevel =>
  value !== null && (processingLevels as readonly string[]).includes(value);

function remembered(): ProcessingLevel | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return isLevel(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The level of the tracks on the map (docs/architecture.md §17.6): `?level=`
 * in the URL, so links and Back keep it; otherwise the one last chosen on this
 * browser; otherwise Transport.
 */
export function useTrackLevel(): {
  level: ProcessingLevel;
  setLevel: (level: ProcessingLevel) => void;
} {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("level");
  const level = useMemo(
    () => (isLevel(fromUrl) ? fromUrl : (remembered() ?? defaultLevel)),
    [fromUrl],
  );
  // The router applies the new URL in a transition; until then the switch shows the choice already.
  const [shown, show] = useOptimistic(level);
  const setLevel = useCallback(
    (next: ProcessingLevel) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Private browsing: the URL still carries the choice.
      }
      startTransition(() => {
        show(next);
        setParams(
          (current) => {
            const updated = new URLSearchParams(current);
            updated.set("level", next);
            return updated;
          },
          { replace: true, preventScrollReset: true },
        );
      });
    },
    [setParams, show],
  );
  return { level: shown, setLevel };
}
