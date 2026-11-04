import { useCallback, useEffect, useRef } from "react";

/**
 * Focus for the panel that swaps a list for a person's detail and back, so a
 * screen reader and the keyboard follow it: selecting someone moves focus to
 * the detail's heading, leaving it (the back link, the browser's Back) to
 * that person's row, or to the page's heading when the row is gone (hiding
 * them). Nothing moves on the first render: a link opened on a detail leaves
 * the focus to the page.
 */
export function usePanelFocus(selectedKey: string | null): (element: HTMLElement | null) => void {
  const root = useRef<HTMLElement | null>(null);
  const previous = useRef(selectedKey);
  useEffect(() => {
    const before = previous.current;
    if (before === selectedKey) return;
    previous.current = selectedKey;
    const panel = root.current;
    if (panel === null) return;
    const target =
      selectedKey !== null
        ? panel.querySelector<HTMLElement>("[data-person-heading]")
        : (panel.querySelector<HTMLElement>(`[data-person="${before}"]`) ??
          panel.querySelector<HTMLElement>("[data-page-title]"));
    target?.focus({ preventScroll: false });
  }, [selectedKey]);
  return useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);
}
