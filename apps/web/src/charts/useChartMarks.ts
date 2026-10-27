import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

/** What a mark's element spreads on to take part in the chart's one tab stop and its tooltip. */
export interface MarkHandlers {
  "data-mark": number;
  tabIndex: number;
  onFocus: (event: FocusEvent<SVGElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<SVGElement>) => void;
  onPointerEnter: (event: PointerEvent<SVGElement>) => void;
  onPointerMove: (event: PointerEvent<SVGElement>) => void;
  onClick: (event: MouseEvent<SVGElement>) => void;
}

interface ChartMarks {
  /** The mark whose tooltip shows. */
  shown: number | null;
  /** The mark that has keyboard focus, which draws the focus ring. */
  focused: number | null;
  markProps: (index: number) => MarkHandlers;
  /** For the plot box: the tooltip goes when the pointer leaves the plot. */
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
}

/** Whether focus arrived the way that shows a ring (the keyboard), as the browser decides it. */
function showsFocusRing(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * The mark that a key moves to: along the marks, or for a grid (`columns` >
 * 0) Left/Right along the row, Up/Down between rows, Home/End to the row's
 * ends and with Ctrl (Cmd) to the grid's. Null for any other key.
 */
function nextMark(
  key: string,
  index: number,
  count: number,
  columns: number,
  toCorner: boolean,
): number | null {
  const last = count - 1;
  if (columns > 0) {
    const rowStart = index - (index % columns);
    const rowEnd = Math.min(last, rowStart + columns - 1);
    switch (key) {
      case "ArrowRight":
        return Math.min(index + 1, rowEnd);
      case "ArrowLeft":
        return Math.max(index - 1, rowStart);
      case "ArrowDown":
        return index + columns <= last ? index + columns : index;
      case "ArrowUp":
        return index - columns >= 0 ? index - columns : index;
      case "Home":
        return toCorner ? 0 : rowStart;
      case "End":
        return toCorner ? last : rowEnd;
      default:
        return null;
    }
  }
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(index + 1, last);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(index - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/**
 * The marks of one chart as a single tab stop (Tab enters on the current
 * mark, the first one at the start; arrow keys, Home and End move), with one
 * tooltip: shown for the hovered, tapped or focused mark, hidden when the
 * pointer leaves the plot, focus leaves the mark, the pointer goes down
 * anywhere else, or on Escape.
 */
export function useChartMarks(count: number, columns = 0): ChartMarks {
  const [tabStop, setTabStop] = useState(0);
  const [shown, setShown] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // The chart's SVG, to tell a press elsewhere on the page from one on another of its marks.
  const chart = useRef<SVGSVGElement | null>(null);
  const stop = Math.max(0, Math.min(tabStop, count - 1));
  const show = (index: number, element: SVGElement) => {
    chart.current = element.ownerSVGElement;
    setShown(index);
  };

  useEffect(() => {
    if (shown === null) return undefined;
    // A tap elsewhere hides the tooltip of a tapped mark, which focus alone does not do on every phone.
    const away = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && chart.current?.contains(event.target) === true) return;
      setShown(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [shown]);

  return {
    shown: shown !== null && shown < count ? shown : null,
    focused: focused !== null && focused < count ? focused : null,
    markProps: (index) => ({
      "data-mark": index,
      tabIndex: index === stop ? 0 : -1,
      onFocus: (event) => {
        setTabStop(index);
        setFocused(showsFocusRing(event.currentTarget) ? index : null);
        show(index, event.currentTarget);
      },
      onBlur: () => {
        setShown(null);
        setFocused(null);
      },
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          setShown(null);
          return;
        }
        const next = nextMark(event.key, index, count, columns, event.ctrlKey || event.metaKey);
        if (next === null) return;
        // The keys move between marks, never scroll the page.
        event.preventDefault();
        event.currentTarget.ownerSVGElement
          ?.querySelector<SVGElement>(`[data-mark="${next}"]`)
          ?.focus();
      },
      // A finger only hovers on its way to scrolling the page: touch shows a tooltip on a tap.
      onPointerEnter: (event) => {
        if (event.pointerType !== "touch") show(index, event.currentTarget);
      },
      onPointerMove: (event) => {
        if (event.pointerType !== "touch") show(index, event.currentTarget);
      },
      onClick: (event) => show(index, event.currentTarget),
    }),
    onPointerLeave: (event) => {
      // A finger lifting off the screen "leaves" too: a tapped mark keeps its tooltip.
      if (event.pointerType !== "touch") setShown(null);
    },
  };
}
