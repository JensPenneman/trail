import { useCallback, useEffect, useRef } from "react";

/**
 * Focus for the panel that swaps one level of the sidebar for another, so a
 * screen reader and the keyboard follow it: opening a level (a person's page,
 * `list:hidden`) moves the focus to its heading, leaving it (the back link, the
 * browser's Back) to the row that opened it (`data-person`, `data-row`), or to
 * the page's heading when the row is gone (hiding them). Nothing moves on the first render, so a link opened on a detail
 * leaves the focus to the page; nor when such a link names someone who is not
 * there (`resolved` never became true): the list that appears is not a move
 * of the person's.
 */
export function usePanelFocus(
  selectedKey: string | null,
  resolved: boolean,
  implied: boolean,
): (element: HTMLElement | null) => void {
  const root = useRef<HTMLElement | null>(null);
  const previous = useRef({ key: selectedKey, resolved, implied });
  useEffect(() => {
    const before = previous.current;
    // A selection the page worked out itself (a guess, then the owner) is no move of the person's.
    if (implied && selectedKey !== null) {
      previous.current = { key: selectedKey, resolved: true, implied: true };
      return;
    }
    previous.current = {
      key: selectedKey,
      resolved: resolved || (before.key === selectedKey && before.resolved),
      implied,
    };
    if (before.key === selectedKey) return;
    const panel = root.current;
    if (panel === null) return;
    const isLevel = (key: string | null) => key?.startsWith("list:") === true;
    // Back from a level of a page (Me's devices) is to the row that opened it, then the page.
    const leavingLevel = isLevel(before.key) && !isLevel(selectedKey);
    const rowOf = (key: string) =>
      panel.querySelector<HTMLElement>(
        key.startsWith("list:") ? `[data-row="${key.slice(5)}"]` : `[data-person="${key}"]`,
      );
    const heading = () =>
      panel.querySelector<HTMLElement>("[data-person-heading], [data-level-heading]");
    const target =
      selectedKey !== null && !leavingLevel
        ? heading()
        : before.key !== null && before.resolved && !before.implied
          ? (rowOf(before.key) ??
            (selectedKey === null ? panel.querySelector<HTMLElement>("[data-page-title]") : heading()))
          : null;
    target?.focus();
  }, [selectedKey, resolved, implied]);
  return useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);
}
