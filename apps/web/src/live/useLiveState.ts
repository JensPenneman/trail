import { useContext, useSyncExternalStore } from "react";
import type { LiveState } from "./createLiveStore";
import { LiveStoreContext } from "./LiveStoreContext";

const disconnected: LiveState = { connection: "connecting", uploads: [] };
const noop = (): (() => void) => () => undefined;

/** Connection state and uploads of the event stream (empty outside the signed-in shell). */
export function useLiveState(): LiveState {
  const store = useContext(LiveStoreContext);
  return useSyncExternalStore(
    store?.subscribe ?? noop,
    store?.getSnapshot ?? (() => disconnected),
    () => disconnected,
  );
}
