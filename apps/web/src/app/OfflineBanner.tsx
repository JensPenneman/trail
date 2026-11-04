import { useEffect, useRef } from "react";
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
  const banner = useRef<HTMLDivElement | null>(null);
  // The page's own layout (the map's top edge, the sheet's detents) starts under the banner.
  useEffect(() => {
    const element = banner.current;
    if (element === null) return undefined;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--banner-height", `${element.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--banner-height");
    };
  }, [online]);
  if (online) return null;
  return (
    <div className="offline-banner" role="status" ref={banner}>
      <Icon name="warning" />
      <span id={offlineReasonId}>
        You’re offline. Trail shows what it kept and catches up when you reconnect; until then
        nothing can be changed.
      </span>
    </div>
  );
}
