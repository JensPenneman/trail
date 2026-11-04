import { type RefObject, useEffect } from "react";

/**
 * The phone sheet's peek height (`--sheet-peek` of the page): just what says
 * where one is — the search and the Me row at the root, the header of a
 * person's page — never more than 45 % of the screen nor more than half of the
 * sheet's view less two rem, so that selecting someone always has a half
 * detent to lift the sheet to. Measured from the sheet's top to the end of the
 * first thing that is marked (`data-peek-end`) or, failing that, the level's
 * heading. History's slider is not in it: it sits right under what is
 * measured. The measure follows what is above and inside it as it appears (the
 * slider, a confirmation, "Connect your first phone"). Levels with nothing to
 * measure (and wide screens, which have no sheet) keep the CSS's own height.
 */
export function usePeekHeight(
  panel: RefObject<HTMLElement | null>,
  level: string | null,
  enabled: boolean,
): void {
  useEffect(() => {
    const found = panel.current;
    const foundPage = found?.closest<HTMLElement>(".map-page");
    if (found == null || foundPage == null || !enabled) return undefined;
    const sheet: HTMLElement = found;
    const page: HTMLElement = foundPage;
    sheet.dataset["level"] = level ?? "root";
    const endOf = () =>
      // The last one that is drawn: the sidebar's content may be hidden while History plays.
      [...sheet.querySelectorAll<HTMLElement>("[data-peek-end]")]
        .reverse()
        .find((element) => element.getClientRects().length > 0) ??
      sheet
        .querySelector<HTMLElement>("[data-person-heading]")
        ?.closest<HTMLElement>(".person-summary") ??
      null;
    const watched = new Set<Element>();
    // One measure per frame, however many changes came: rows re-order and readouts move often.
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const resized = new ResizeObserver(schedule);
    const watch = (element: Element | null) => {
      if (element === null || watched.has(element)) return;
      watched.add(element);
      resized.observe(element);
    };
    function measure() {
      const end = endOf();
      if (end === null) {
        page.style.removeProperty("--sheet-peek");
        return;
      }
      // What has left the page is no longer watched.
      for (const element of watched) {
        if (!element.isConnected) {
          resized.unobserve(element);
          watched.delete(element);
        }
      }
      // Everything above the end and the end itself can change the height without the sheet's.
      watch(sheet);
      watch(end);
      for (const child of sheet.children) watch(child);
      const height = end.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
      page.style.setProperty(
        "--sheet-peek",
        `min(${Math.ceil(height + 16)}px, 45svh, calc(var(--sheet-view) / 2 - var(--space-8)))`,
      );
    }
    measure();
    // What appears or goes (the slider, a notice, the setup card) is a change of the tree.
    const changed = new MutationObserver(schedule);
    changed.observe(sheet, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      changed.disconnect();
      page.style.removeProperty("--sheet-peek");
    };
  }, [panel, level, enabled]);
}
