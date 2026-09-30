import { Icon } from "../ui/Icon";
import { useOnline } from "../ui/useOnline";
import "./OfflineBanner.css";

/** Explains why nothing updates while the device has no network. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="warning" />
      <span>You’re offline. Trail shows what it had loaded and catches up when you reconnect.</span>
    </div>
  );
}
