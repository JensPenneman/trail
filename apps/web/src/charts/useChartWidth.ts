import { useCallback, useState } from "react";

/** What a chart lays out against: its plot box's width and the root font size, both in CSS px. */
interface ChartSize {
  /** The ref callback for the plot box. */
  measure: (element: HTMLElement | null) => (() => void) | undefined;
  width: number;
  /** 1 rem: label sizes follow it when someone sets a larger default font. */
  rem: number;
}

/**
 * The width of a chart's plot box, following it as it resizes, so the SVG is
 * drawn at its real size: crisp text, and axis labels thinned to what fits.
 * Until the box has been measured — and in tests, where nothing is laid out —
 * it is `fallback`; a box that measures 0 (hidden, detached) keeps the last
 * width rather than collapsing the chart.
 */
export function useChartWidth(fallback = 640): ChartSize {
  const [width, setWidth] = useState(fallback);
  const [rem, setRem] = useState(16);
  const measure = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const update = (next: number) => {
      if (next > 0) setWidth(Math.floor(next));
    };
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    if (rootSize > 0) setRem(rootSize);
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { measure, width, rem };
}
