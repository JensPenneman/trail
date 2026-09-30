import { useLiveState } from "../live/useLiveState";
import "./ConnectionIndicator.css";

const labels = {
  open: { short: "Live", long: "Live updates on" },
  connecting: { short: "Connecting", long: "Connecting to live updates…" },
  reconnecting: { short: "Reconnecting", long: "Live updates interrupted — reconnecting…" },
} as const;

/** Whether the event stream is connected — the page updates by itself only while it is. */
export function ConnectionIndicator() {
  const { connection } = useLiveState();
  const label = labels[connection];
  return (
    <span className={`connection connection--${connection}`} title={label.long}>
      <span className="connection__dot" aria-hidden="true" />
      <span className="connection__short" aria-hidden="true">
        {label.short}
      </span>
      <span className="visually-hidden">{label.long}</span>
    </span>
  );
}
