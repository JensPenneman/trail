import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePanelFocus } from "../src/pages/people/usePanelFocus";

function Panel({ selected }: { selected: string | null }) {
  const ref = usePanelFocus(selected, true, false);
  return (
    <section ref={ref}>
      <h2 tabIndex={-1} data-person-heading>
        Someone
      </h2>
    </section>
  );
}

describe("the focus of the sidebar's levels", () => {
  it("moves to the heading without scrolling the page, which the sheet's own scroll owns", () => {
    const view = render(<Panel selected={null} />);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    view.rerender(<Panel selected="me" />);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(view.container.querySelector("h2"));
    focus.mockRestore();
  });
});
