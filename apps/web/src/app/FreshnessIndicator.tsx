import { useEffect, useRef, useState } from "react";
import { useFormatter } from "../format/useFormatter";
import { useLiveState } from "../live/useLiveState";
import { useNow } from "../time/useNow";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/iconPaths";
import { useOnline } from "../ui/useOnline";
import { useLiveFreshness } from "./useLiveFreshness";
import "./FreshnessIndicator.css";

/** The live region speaks at most this often; a later state waits for its turn. */
const announceEveryMs = 60_000;

type FreshnessState = "offline" | "updating" | "live" | "stored";

const icons: Record<FreshnessState, IconName> = {
  offline: "warning",
  updating: "refresh",
  live: "live",
  stored: "history",
};

/**
 * Says how fresh the live data on screen is, beside the connection indicator
 * (docs/architecture.md §14): "Updated 3 min ago" while the copy from the
 * last visit is on screen, "Updating…" while it is asked for again, "Live"
 * once the stream is open and everything shown came from the server in this
 * visit, "Offline · as of 10:32" without a network. In the live state the
 * connection indicator beside it says so on screen, and this line only to
 * assistive technology. Its status region announces changes of state, never
 * the minutes ticking, and at most once a minute. Pages without live data
 * (Settings, Insights) show nothing.
 */
export function FreshnessIndicator() {
  const freshness = useLiveFreshness();
  const { connection } = useLiveState();
  const online = useOnline();
  const format = useFormatter();
  const now = useNow(15_000);
  const asOf = freshness.asOf ?? now;
  const state: FreshnessState = !online
    ? "offline"
    : freshness.updating
      ? "updating"
      : connection === "open" && !freshness.fromCopy
        ? "live"
        : "stored";
  const text = {
    offline: `Offline · as of ${format.time(asOf)}`,
    updating: "Updating…",
    live: "Live",
    stored: `Updated ${format.relative(asOf, now)}`,
  }[state];
  const spoken = {
    offline: `Offline, showing what Trail kept, as of ${format.time(asOf)}`,
    updating: "Updating",
    live: "Live",
    stored: `Showing what Trail kept, updated at ${format.time(asOf)}`,
  }[state];
  const announced = useThrottled(freshness.shown ? spoken : "", announceEveryMs);
  return (
    <span className={`freshness freshness--${state}`} hidden={!freshness.shown}>
      <span className="freshness__line" aria-hidden="true" title={format.dateTime(asOf)}>
        <Icon name={icons[state]} />
        <span className="freshness__text">{text}</span>
      </span>
      <span className="visually-hidden" role="status">
        {announced}
      </span>
    </span>
  );
}

/** `value`, changing at most every `everyMs`: a change within the wait comes at its end. */
function useThrottled(value: string, everyMs: number): string {
  const [shown, setShown] = useState(value);
  const lastChange = useRef(0);
  useEffect(() => {
    if (value === shown) return;
    const wait = lastChange.current + everyMs - Date.now();
    if (shown === "" || wait <= 0) {
      lastChange.current = Date.now();
      setShown(value);
      return;
    }
    const timer = setTimeout(() => {
      lastChange.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, everyMs]);
  return shown;
}
