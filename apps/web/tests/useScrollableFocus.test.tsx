import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScrollableFocus } from "../src/ui/useScrollableFocus";

function Box({ children }: { children: string }) {
  const scrollable = useScrollableFocus();
  return (
    <section aria-label="Uploads" ref={scrollable} style={{ overflowX: "auto" }}>
      <p>{children}</p>
    </section>
  );
}

/** jsdom lays nothing out: the sizes a browser would report. */
function measure(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
}

describe("useScrollableFocus", () => {
  it("makes a scrolling box a tab stop only while its content does not fit", () => {
    let resized: () => void = () => undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    render(<Box>A table wider than the screen</Box>);
    const box = screen.getByRole("region", { name: "Uploads" });
    expect(box).not.toHaveAttribute("tabindex");

    measure(box, 900, 320);
    resized();
    expect(box).toHaveAttribute("tabindex", "0");

    measure(box, 900, 1200);
    resized();
    expect(box).not.toHaveAttribute("tabindex");
  });
});
