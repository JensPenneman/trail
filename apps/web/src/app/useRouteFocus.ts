import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/** The page an address belongs to: its first segment (`/settings/tokens` → `settings`). */
const pageOf = (pathname: string): string => pathname.split("/")[1] ?? "";

/**
 * After an in-app navigation, moves focus to the new page's h1 so keyboard and
 * screen reader users start at the page they chose instead of wherever the old
 * page left them; within one page (another section of Settings) to the new
 * section's heading, since the h1 stays the same. The first render keeps the
 * browser's default. Only path changes count: a new date in `?date=` or
 * another view of the map is the same page.
 */
export function useRouteFocus(): void {
  const { pathname } = useLocation();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current !== null && previous.current !== pathname) {
      const samePage = pageOf(previous.current) === pageOf(pathname);
      const target =
        (samePage ? document.querySelector<HTMLElement>("main [data-section-title]") : null) ??
        document.querySelector<HTMLElement>("main [data-page-title]") ??
        document.querySelector<HTMLElement>("main");
      target?.focus({ preventScroll: true });
    }
    previous.current = pathname;
  }, [pathname]);
}
