import { useCallback, useEffect, useRef } from "react";

/**
 * Focus for the panel that swaps a list for a person's detail and back, so a
 * screen reader and the keyboard follow it: selecting someone moves the focus
 * to the detail's heading, leaving it (the back link, the browser's Back) to
 * that person's row, or to the page's heading when the row is gone (hiding
 * them). Nothing moves on the first render, so a link opened on a detail
 * leaves the focus to the page; nor when such a link names someone who is not
 * there (`resolved` never became true): the list that appears is not a move
 * of the person's.
 */
export function usePanelFocus(
  selectedKey: string | null,
  resolved: boolean,
): (element: HTMLElement | null) => void {
  const root = useRef<HTMLElement | null>(null);
  const previous = useRef({ key: selectedKey, resolved });
  useEffect(() => {
    const before = previous.current;
    previous.current = {
      key: selectedKey,
      resolved: resolved || (before.key === selectedKey && before.resolved),
    };
    if (before.key === selectedKey) return;
    const panel = root.current;
    if (panel === null) return;
    const target =
      selectedKey !== null
        ? panel.querySelector<HTMLElement>("[data-person-heading]")
        : before.resolved
          ? (panel.querySelector<HTMLElement>(`[data-person="${before.key}"]`) ??
            panel.querySelector<HTMLElement>("[data-page-title]"))
          : null;
    target?.focus();
  }, [selectedKey, resolved]);
  return useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);
}
