import { useCallback } from "react";

const scrolls = (overflow: string): boolean => overflow === "auto" || overflow === "scroll";

/** Whether the element is a scroll container whose content does not fit (either axis). */
function overflowing(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return (
    (scrolls(style.overflowX) && element.scrollWidth > element.clientWidth) ||
    (scrolls(style.overflowY) && element.scrollHeight > element.clientHeight)
  );
}

/**
 * For a box that scrolls on its own (a wide table, the side panel of a map
 * page): while it scrolls it is a tab stop, so keyboard users can scroll it
 * with the arrow keys even when it holds nothing focusable (WCAG 2.1.1); when
 * everything fits it stays out of the tab order. Returns the ref callback.
 * Name the element (a labelled `<section>`), so screen readers can say what
 * received focus.
 */
export function useScrollableFocus(): (element: HTMLElement | null) => (() => void) | undefined {
  return useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const update = () => {
      if (overflowing(element)) element.tabIndex = 0;
      else element.removeAttribute("tabindex");
    };
    // Content changes size as it loads, and whole blocks appear later.
    const resized = new ResizeObserver(update);
    const observeChildren = () => {
      for (const child of element.children) resized.observe(child);
    };
    const changed = new MutationObserver(() => {
      observeChildren();
      update();
    });
    resized.observe(element);
    observeChildren();
    changed.observe(element, { childList: true });
    update();
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, []);
}
