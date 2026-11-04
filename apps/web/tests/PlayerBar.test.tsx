import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NowStrip } from "../src/pages/map/history/playback/NowStrip";
import { PlayerBar } from "../src/pages/map/history/playback/PlayerBar";
import { dayBounds } from "../src/pages/map/history/playback/playbackModel";
import { user } from "./support/fixtures";
import { renderPage } from "./support/renderPage";

const start = dayBounds("2026-11-03", "Europe/Brussels").start;
const clock = start + 14 * 3600 + 5 * 60;

function bar(props: Partial<Parameters<typeof PlayerBar>[0]> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onPreviousMove: vi.fn(),
    onNextMove: vi.fn(),
    onRate: vi.fn(),
    onSkipStops: vi.fn(),
    onSeek: vi.fn(),
    onExit: vi.fn(),
  };
  renderPage(
    <PlayerBar
      status="playing"
      clock={clock}
      start={start}
      end={start + 20 * 3600}
      rate={5}
      skipStops={false}
      {...handlers}
      {...props}
    />,
    { user },
  );
  return handlers;
}

describe("the player bar", () => {
  it("is the region Playback, with the moves, one Play/Pause button, the readout and the way out", () => {
    bar();
    const region = screen.getByRole("region", { name: "Playback" });
    expect(within(region).getByRole("button", { name: "Previous move" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Play" })).toBeNull();
    expect(within(region).getByRole("button", { name: "Next move" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Exit playback" })).toBeInTheDocument();
    expect(within(region).getByRole("status")).toHaveTextContent("Tue 3 Nov · 14:05");
  });

  it("names the button Play when paused or ended, Pause while playing or loading", () => {
    for (const [status, name] of [
      ["playing", "Pause"],
      ["loading", "Pause"],
      ["paused", "Play"],
      ["ended", "Play"],
    ] as const) {
      const { unmount } = (() => {
        bar({ status });
        return { unmount: () => document.body.replaceChildren() };
      })();
      expect(screen.getByRole("button", { name }), status).toBeInTheDocument();
      unmount();
    }
  });

  it("offers the speeds as a group, the chosen one checked", async () => {
    const handlers = bar({ rate: 15 });
    const speed = screen.getByRole("group", { name: "Speed" });
    expect(
      within(speed)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["1 min/s", "5 min/s", "15 min/s", "1 h/s"]);
    expect(within(speed).getByRole("radio", { name: "15 min/s" })).toBeChecked();
    await userEvent.setup().click(within(speed).getByRole("radio", { name: "1 h/s" }));
    expect(handlers.onRate).toHaveBeenCalledWith(60);
  });

  it("has a switch Skip stops and tells when it is turned", async () => {
    const handlers = bar({ skipStops: true });
    const skip = screen.getByRole("switch", { name: "Skip stops" });
    expect(skip).toBeChecked();
    await userEvent.setup().click(skip);
    expect(handlers.onSkipStops).toHaveBeenCalledWith(false);
  });

  it("has a slider Position at in whole minutes that says the day and time", () => {
    const handlers = bar();
    const slider = screen.getByRole("slider", { name: "Position at" });
    expect(slider).toHaveAttribute("step", "1");
    expect(slider).toHaveAttribute("aria-valuetext", "Tuesday, 3 November 2026, 14:05");
    expect(Number(slider.getAttribute("min"))).toBe(start / 60);
    expect(Number(slider.getAttribute("max"))).toBe((start + 20 * 3600) / 60);
    expect(Number(slider.getAttribute("value"))).toBe(clock / 60);
    expect(handlers.onSeek).not.toHaveBeenCalled();
  });

  it("seeks in seconds, and keeps the slider inside while the end is not known", async () => {
    const handlers = bar({ end: null });
    const slider = screen.getByRole("slider", { name: "Position at" });
    expect(Number(slider.getAttribute("max"))).toBe(clock / 60);
    fireEvent.change(slider, { target: { value: String(clock / 60 - 1) } });
    expect(handlers.onSeek).toHaveBeenCalledWith(clock - 60);
  });

  it("calls its handlers", async () => {
    const handlers = bar();
    const person = userEvent.setup();
    await person.click(screen.getByRole("button", { name: "Pause" }));
    await person.click(screen.getByRole("button", { name: "Previous move" }));
    await person.click(screen.getByRole("button", { name: "Next move" }));
    await person.click(screen.getByRole("button", { name: "Exit playback" }));
    expect(handlers.onToggle).toHaveBeenCalledOnce();
    expect(handlers.onPreviousMove).toHaveBeenCalledOnce();
    expect(handlers.onNextMove).toHaveBeenCalledOnce();
    expect(handlers.onExit).toHaveBeenCalledOnce();
  });

  it("says that it waits for a day, and is busy meanwhile", () => {
    bar({ status: "loading" });
    expect(screen.getByRole("region", { name: "Playback" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading the next day")).toBeInTheDocument();
  });
});

describe("the strip of what each device was doing", () => {
  it("is the region At this moment, with a line per device", () => {
    renderPage(
      <NowStrip
        entries={[
          {
            id: "a",
            name: "iPhone 16",
            slot: 0,
            palette: "device",
            mode: "Cycling",
            speed: 4.5,
            position: { lat: 51.0543, lon: 3.7174 },
          },
          {
            id: "b",
            name: "Ana’s iPhone",
            slot: 1,
            palette: "person",
            mode: null,
            speed: 0.1,
            position: { lat: 51.1, lon: 3.8 },
          },
          {
            id: "c",
            name: "Car",
            slot: 2,
            palette: "device",
            mode: null,
            speed: null,
            position: null,
          },
        ]}
      />,
      { user },
    );
    const region = screen.getByRole("region", { name: "At this moment" });
    const [phone, ana, car] = within(region).getAllByRole("listitem") as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(phone).toHaveTextContent(/iPhone 16.*Cycling · 16 km\/h · 51\.0543° N, 3\.7174° E/);
    // Someone else has no mode: moving or still, from the speed.
    expect(ana).toHaveTextContent(/Ana’s iPhone.*Still · 0 km\/h · 51\.1000° N, 3\.8000° E/);
    expect(car).toHaveTextContent("Car");
    expect(car).toHaveTextContent("no position recorded then");
  });
});
