import { type RefObject, useEffect } from "react";

/**
 * The phone sheet's peek height (`--sheet-peek` of the page): just what says
 * where one is — the Me row at the root, the header of a person's page —
 * never more than 45 % of the screen. Measured from the sheet's top to the end
 * of the first thing that is marked (`data-peek-end`) or, failing that, the
 * level's heading, and followed as the content changes size. Levels with
 * nothing to measure (and wide screens, which have no sheet) keep the CSS's
 * own height.
 */
export function usePeekHeight(
  panel: RefObject<HTMLElement | null>,
  level: string | null,
  enabled: boolean,
): void {
  useEffect(() => {
    const sheet = panel.current;
    const page = sheet?.closest<HTMLElement>(".map-page");
    if (sheet == null || page == null || !enabled) return undefined;
    sheet.dataset["level"] = level ?? "root";
    const measure = () => {
      const end =
        sheet.querySelector<HTMLElement>("[data-peek-end]") ??
        sheet
          .querySelector<HTMLElement>("[data-person-heading]")
          ?.closest<HTMLElement>(".person-summary") ??
        null;
      if (end === null) {
        page.style.removeProperty("--sheet-peek");
        return;
      }
      const height = end.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
      page.style.setProperty("--sheet-peek", `min(${Math.ceil(height + 16)}px, 45svh)`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => {
      observer.disconnect();
      page.style.removeProperty("--sheet-peek");
    };
  }, [panel, level, enabled]);
}
