import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayBounds } from "../src/pages/map/history/playback/playbackModel";
import type { PlaybackWorld } from "../src/pages/map/history/playback/playbackReducer";
import { usePlayerEngine } from "../src/pages/map/history/playback/usePlayerEngine";
import { usePlayerKeys } from "../src/pages/map/history/playback/usePlayerKeys";
import { usePlayerState } from "../src/pages/map/history/playback/usePlayerState";
import { useDismiss } from "../src/ui/useDismiss";

const zone = "Europe/Brussels";
const tue = "2026-11-03";
const thu = "2026-11-05";
const at = (day: string, hours: number, minutes = 0) =>
  dayBounds(day, zone).start + hours * 3600 + minutes * 60;

const baseWorld: PlaybackWorld = {
  timeZone: zone,
  days: [tue, thu],
  daysComplete: true,
  moves: [
    { from: at(tue, 8), to: at(tue, 9) },
    { from: at(tue, 17), to: at(tue, 18) },
  ],
  quiet: [],
  loaded: () => true,
  end: at(thu, 15),
};

let latest: ReturnType<typeof usePlayerState> | null = null;

/** The engine and the keys over a player, with what the keys must leave alone beside it. */
function Harness({
  world = baseWorld,
  reducedMotion = false,
}: {
  world?: PlaybackWorld;
  reducedMotion?: boolean;
}) {
  const player = usePlayerState();
  latest = player;
  usePlayerEngine(player, { world, reducedMotion });
  usePlayerKeys(player);
  return (
    <div>
      <output aria-label="state">
        {player.state.status} {player.state.day} {player.state.clock} {player.state.rate}
      </output>
      <button type="button">A button</button>
      <input aria-label="A field" />
      <dialog open aria-label="A dialog">
        <p>Inside a dialog</p>
      </dialog>
    </div>
  );
}

const read = () => {
  const [status, day, clock, rate] = (screen.getByLabelText("state").textContent ?? "").split(" ");
  return { status, day, clock: Number(clock), rate: Number(rate) };
};

const controls = () => {
  if (latest === null) throw new Error("no player");
  return latest.controls;
};

function Popover({ onDismiss }: { onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, onDismiss, ref);
  return (
    <div ref={ref}>
      <Harness />
    </div>
  );
}

describe("the clock", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "setInterval",
        "clearInterval",
        "performance",
        "Date",
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a minute of playback per second at 1 min/s, in frames of at most 30 a second", () => {
    render(<Harness />);
    act(() => {
      controls().setRate(60);
      controls().enter(tue, at(tue, 10));
    });
    const start = read().clock;
    const frames = vi.spyOn(globalThis, "requestAnimationFrame");
    act(() => vi.advanceTimersByTime(1000));
    // An hour a second, give or take the last frame not yet due.
    expect(read().clock - start).toBeGreaterThan(3400);
    expect(read().clock - start).toBeLessThanOrEqual(3600);
    frames.mockRestore();
  });

  it("updates at most 30 times a second", () => {
    render(<Harness />);
    act(() => controls().enter(tue, at(tue, 10)));
    let updates = 0;
    let last = read().clock;
    for (let ms = 0; ms < 1000; ms += 4) {
      act(() => vi.advanceTimersByTime(4));
      if (read().clock !== last) {
        updates += 1;
        last = read().clock;
      }
    }
    expect(updates).toBeGreaterThan(15);
    expect(updates).toBeLessThanOrEqual(30);
  });

  it("counts a long wait between frames (a tab in the background) as 250 ms", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.useRealTimers();
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(performance, "now").mockReturnValue(0);
    render(<Harness />);
    act(() => controls().enter(tue, at(tue, 10)));
    const before = read().clock;
    // The browser hands the frame back after five seconds.
    act(() => callbacks.at(-1)?.(5000));
    expect(read().clock - before).toBeCloseTo(0.25 * 5 * 60, 6);
    vi.restoreAllMocks();
  });

  it("steps once a second by the speed's minutes with reduced motion", () => {
    render(<Harness reducedMotion />);
    act(() => {
      controls().setRate(15);
      controls().enter(tue, at(tue, 10));
    });
    const start = read().clock;
    act(() => vi.advanceTimersByTime(3000));
    expect(read().clock - start).toBe(3 * 15 * 60);
  });

  it("stops when paused", () => {
    render(<Harness />);
    act(() => controls().enter(tue, at(tue, 10)));
    act(() => vi.advanceTimersByTime(200));
    act(() => controls().pause());
    const paused = read().clock;
    act(() => vi.advanceTimersByTime(2000));
    expect(read()).toMatchObject({ status: "paused", clock: paused });
  });

  it("waits for a day's tracks and plays on once they are in", () => {
    const waiting = { ...baseWorld, loaded: (day: string) => day !== thu };
    const { rerender } = render(<Harness world={waiting} />);
    act(() => controls().enter(tue, at(tue, 23, 59)));
    act(() => vi.advanceTimersByTime(3000));
    expect(read()).toMatchObject({ status: "loading", day: thu });
    rerender(<Harness world={baseWorld} />);
    expect(read().status).toBe("playing");
  });
});

describe("the keys", () => {
  const press = (target: Element | Window, init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };

  function started() {
    render(<Harness />);
    // Started early, so that there is a past to step back into.
    act(() => controls().enter(tue, at(tue, 6)));
    act(() => controls().pause());
    act(() => controls().seek(at(tue, 12)));
    return read().clock;
  }

  it("play and pause with Space, step with the arrows, leave with Escape", () => {
    const clock = started();
    press(document.body, { key: " " });
    expect(read().status).toBe("playing");
    press(document.body, { key: " " });
    expect(read().status).toBe("paused");
    press(document.body, { key: "ArrowRight" });
    expect(read().clock).toBe(clock + 5 * 60);
    press(document.body, { key: "ArrowLeft" });
    press(document.body, { key: "ArrowLeft" });
    expect(read().clock).toBe(clock - 5 * 60);
    press(document.body, { key: "Escape" });
    expect(read().status).toBe("off");
  });

  it("go to the previous and next move with Shift and the arrows", () => {
    started();
    press(document.body, { key: "ArrowRight", shiftKey: true });
    expect(read().clock).toBe(at(tue, 17));
    press(document.body, { key: "ArrowLeft", shiftKey: true });
    expect(read().clock).toBe(at(tue, 8));
  });

  it("take the keys they use, so that the page does not scroll", () => {
    started();
    expect(press(document.body, { key: " " }).defaultPrevented).toBe(true);
    expect(press(document.body, { key: "ArrowRight" }).defaultPrevented).toBe(true);
    expect(press(document.body, { key: "a" }).defaultPrevented).toBe(false);
  });

  it("leave alone anything with Ctrl, Meta or Alt", () => {
    const clock = started();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      press(document.body, { key: "ArrowRight", ...modifier });
      press(document.body, { key: "Escape", ...modifier });
    }
    expect(read()).toMatchObject({ status: "paused", clock });
  });

  it("leave alone what is already handled (a popover that took its Escape)", () => {
    started();
    const handle = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", handle);
    press(document.body, { key: "Escape" });
    document.removeEventListener("keydown", handle);
    expect(read().status).toBe("paused");
  });

  it("leave alone inputs and dialogs, and Space on a focused button", () => {
    const clock = started();
    press(screen.getByLabelText("A field"), { key: "ArrowRight" });
    press(screen.getByLabelText("A field"), { key: " " });
    press(screen.getByText("Inside a dialog"), { key: "Escape" });
    press(screen.getByText("Inside a dialog"), { key: "ArrowLeft" });
    press(screen.getByRole("button", { name: "A button" }), { key: " " });
    expect(read()).toMatchObject({ status: "paused", clock });
    // The button's other keys still reach the player.
    press(screen.getByRole("button", { name: "A button" }), { key: "ArrowRight" });
    expect(read().clock).toBe(clock + 5 * 60);
  });

  it("listen only while a player is on", () => {
    render(<Harness />);
    const event = press(document.body, { key: " " });
    expect(read().status).toBe("off");
    expect(event.defaultPrevented).toBe(false);
  });

  it("stay out of the way of a popover's own Escape, which marks it handled", async () => {
    const onDismiss = vi.fn();
    render(<Popover onDismiss={onDismiss} />);
    act(() => controls().enter(tue, at(tue, 12)));
    await userEvent.setup().keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledWith("escape");
    expect(read().status).not.toBe("off");
  });
});
