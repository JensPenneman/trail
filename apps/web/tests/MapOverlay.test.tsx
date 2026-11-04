import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HistoryControls } from "../src/pages/map/history/HistoryControls";
import { MapOptions } from "../src/pages/map/MapOptions";
import { MapOverlay } from "../src/pages/map/MapOverlay";

const options = (
  <MapOptions note="1 of 2 devices">
    <p>Map style</p>
  </MapOptions>
);

function Controls({ mode = "day" as "day" | "range" }) {
  const [open, setOpen] = useState(false);
  return (
    <HistoryControls
      selection={{ mode, from: "2026-10-27", to: "2026-10-27", deviceIds: null }}
      today="2026-10-28"
      onDay={vi.fn()}
      onRange={vi.fn()}
      open={open}
      onOpenChange={setOpen}
      calendar={() => <p>Calendar</p>}
      focusIn={false}
    />
  );
}

describe("MapOverlay", () => {
  it("holds the view switch and the options button, with the view's row under them", () => {
    render(
      <MapOverlay
        view="live"
        views={["live", "history"]}
        onViewChange={vi.fn()}
        options={options}
        controls={<p>History row</p>}
        onMeasure={vi.fn()}
      />,
    );
    expect(screen.getByRole("group", { name: "Map view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Map options/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("History row")).toBeInTheDocument();
  });
});

describe("MapOptions", () => {
  it("keeps its body in the document while closed, and names a filter on its button", () => {
    render(options);
    expect(screen.getByText("Map style")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map options 1 of 2 devices" })).toBeInTheDocument();
  });

  it("closes when focus moves outside, without taking it back", async () => {
    const user = userEvent.setup();
    render(
      <>
        {options}
        <button type="button">Elsewhere</button>
      </>,
    );
    const button = screen.getByRole("button", { name: /^Map options/ });
    await user.click(button);
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("opens from its button, closes on Escape with focus back on the button", async () => {
    const user = userEvent.setup();
    render(options);
    const button = screen.getByRole("button", { name: /^Map options/ });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("closes on a press outside and leaves focus where it was put", async () => {
    const user = userEvent.setup();
    render(
      <>
        {options}
        <button type="button">Elsewhere</button>
      </>,
    );
    const button = screen.getByRole("button", { name: /^Map options/ });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("stays open for a press inside", async () => {
    const user = userEvent.setup();
    render(options);
    const button = screen.getByRole("button", { name: /^Map options/ });
    await user.click(button);
    await user.click(screen.getByText("Map style"));
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});

describe("HistoryControls", () => {
  it("steps by day around a date button that opens the popover", async () => {
    const user = userEvent.setup();
    render(<Controls />);
    expect(screen.getByRole("button", { name: "Previous day" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next day" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.queryByText("Calendar")).not.toBeInTheDocument();
    const date = screen.getByRole("button", { name: /choose another day/ });
    await user.click(date);
    expect(screen.getByRole("radio", { name: "Day" })).toBeChecked();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Calendar")).not.toBeInTheDocument();
    expect(date).toHaveFocus();
  });

  it("has the date button alone for a period, with the form in the popover", async () => {
    const user = userEvent.setup();
    render(<Controls mode="range" />);
    expect(screen.queryByRole("button", { name: "Previous day" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /choose another day/ }));
    expect(screen.getByRole("radio", { name: "Period" })).toBeChecked();
  });
});
