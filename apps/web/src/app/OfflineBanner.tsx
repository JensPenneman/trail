import { useEffect, useRef } from "react";
import { Icon } from "../ui/Icon";
import { useOnline } from "../ui/useOnline";
import { offlineReasonId } from "./useReadOnly";
import "./OfflineBanner.css";

/**
 * Explains why nothing updates while the device has no network, and why
 * nothing can be changed: the controls that would are off and point here.
 */
export function OfflineBanner({ sticky = false }: { sticky?: boolean }) {
  const online = useOnline();
  const banner = useRef<HTMLDivElement | null>(null);
  // On a page that asks for it (the People page) the banner is sticky and its height is
  // published: the map's top edge and the sheet's detents start under it.
  useEffect(() => {
    const element = banner.current;
    if (element === null || !sticky) return undefined;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--banner-height", `${element.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--banner-height");
    };
  }, [online, sticky]);
  if (online) return null;
  return (
    <div
      className={sticky ? "offline-banner offline-banner--sticky" : "offline-banner"}
      role="status"
      ref={banner}
    >
      <Icon name="warning" />
      <span id={offlineReasonId}>
        You’re offline. Trail shows what it kept and catches up when you reconnect; until then
        nothing can be changed.
      </span>
    </div>
  );
}
