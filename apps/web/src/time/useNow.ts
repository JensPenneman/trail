import { useCallback, useSyncExternalStore } from "react";
import { clockStore } from "./clockStore";

/** Current time in epoch ms, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const subscribe = useCallback(
    (listener: () => void) => clockStore.subscribe(intervalMs, listener),
    [intervalMs],
  );
  const getSnapshot = useCallback(() => clockStore.getSnapshot(intervalMs), [intervalMs]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
