import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * After an in-app navigation, moves focus to the new page's h1 so keyboard and
 * screen reader users start at the page they chose instead of wherever the old
 * page left them. The first render keeps the browser's default. Only path
 * changes count: a new date in `?date=` is the same page.
 */
export function useRouteFocus(): void {
  const { pathname } = useLocation();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current !== null && previous.current !== pathname) {
      const target =
        document.querySelector<HTMLElement>("main [data-page-title]") ??
        document.querySelector<HTMLElement>("main");
      target?.focus({ preventScroll: true });
    }
    previous.current = pathname;
  }, [pathname]);
}
