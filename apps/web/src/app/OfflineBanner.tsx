import { Icon } from "../ui/Icon";
import { useOnline } from "../ui/useOnline";
import { offlineReasonId } from "./useReadOnly";
import "./OfflineBanner.css";

/**
 * Explains why nothing updates while the device has no network, and why
 * nothing can be changed: the controls that would are off and point here.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="warning" />
      <span id={offlineReasonId}>
        You’re offline. Trail shows what it kept and catches up when you reconnect; until then
        nothing can be changed.
      </span>
    </div>
  );
}
