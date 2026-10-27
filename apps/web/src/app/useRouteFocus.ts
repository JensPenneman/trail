import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/** The heading an address's `#part` leads to, when the page made it a focus target. */
function partOf(hash: string): HTMLElement | null {
  if (hash.length < 2) return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  const part = document.getElementById(id);
  return part !== null && part.closest("main") !== null && part.tabIndex === -1 ? part : null;
}

/**
 * After an in-app navigation, moves focus to the new page's h1 so keyboard and
 * screen reader users start at the page they chose instead of wherever the old
 * page left them — or to what the page marks with `data-route-focus` instead
 * (Settings: the row of the page one came back from), or to the heading the
 * address's `#part` names. The first render keeps the browser's default. Only
 * path changes count: a new date in `?date=`, another view of the map or
 * another `#part` of the page is the same page.
 */
export function useRouteFocus(): void {
  const { pathname, hash } = useLocation();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current !== null && previous.current !== pathname) {
      const target =
        document.querySelector<HTMLElement>("main [data-route-focus]") ??
        partOf(hash) ??
        document.querySelector<HTMLElement>("main [data-page-title]") ??
        document.querySelector<HTMLElement>("main");
      target?.focus({ preventScroll: true });
    }
    previous.current = pathname;
  }, [pathname, hash]);
}
