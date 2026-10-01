import type { QueryClient } from "@tanstack/react-query";

/*
 * Devices this tab knows are gone: being deleted here, deleted, or reported
 * by the server's `device-removed` event. Their queries must never run again —
 * a page can stay mounted for a moment after navigating away (React Router
 * renders the next route in a transition), and every fetch would answer 404.
 * The queries ask at fetch time (function `enabled`), so a render that has not
 * caught up yet cannot start one.
 */
const goneByClient = new WeakMap<QueryClient, Set<string>>();

export const goneDevices = {
  mark(queryClient: QueryClient, deviceId: string): void {
    const gone = goneByClient.get(queryClient) ?? new Set<string>();
    gone.add(deviceId);
    goneByClient.set(queryClient, gone);
  },
  /** A deletion that failed: the device is still there. */
  unmark(queryClient: QueryClient, deviceId: string): void {
    goneByClient.get(queryClient)?.delete(deviceId);
  },
  has(queryClient: QueryClient, deviceId: string): boolean {
    return goneByClient.get(queryClient)?.has(deviceId) ?? false;
  },
};
