import { type UseQueryResult, useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@trail/contracts/user";
import { useEffect, useState } from "react";
import { ApiError } from "../api/ApiError";
import { browserCacheOf } from "../cache/attachBrowserCache";
import { useOnline } from "../ui/useOnline";

export interface OfflineSession {
  /** The account to paint as from the copy, or null. */
  user: SessionUser | null;
  /** The copy is being read: wait for it rather than say the server is unreachable. */
  looking: boolean;
}

/**
 * The account to paint the signed-in pages as when the session cannot be
 * checked — the browser is offline, or the probe never reached the server —
 * from the copy on disk (docs/architecture.md §14): the shell paints from the
 * store under the offline banner. Online with a working server the probe
 * gates every paint, as always; once it answers, its answer counts, and a
 * page painted from the copy stays on screen until then.
 */
export function useOfflineSession(session: UseQueryResult<SessionUser | null>): OfflineSession {
  const client = useQueryClient();
  const online = useOnline();
  const cache = browserCacheOf(client);
  const [found, setFound] = useState<{ user: SessionUser | null } | null>(null);
  const unreachable =
    session.data === undefined &&
    (!online ||
      session.fetchStatus === "paused" ||
      (session.isError && session.error instanceof ApiError && session.error.code === "network"));
  useEffect(() => {
    if (!unreachable || cache === null || found !== null) return;
    let cancelled = false;
    void (async () => {
      const user = await cache.offlineUser();
      if (user !== null) await cache.paintOffline(user);
      if (!cancelled) setFound({ user });
    })();
    return () => {
      cancelled = true;
    };
  }, [unreachable, cache, found]);
  if (session.data !== undefined) return { user: null, looking: false };
  return {
    user: found?.user ?? null,
    looking: unreachable && cache !== null && found === null,
  };
}
