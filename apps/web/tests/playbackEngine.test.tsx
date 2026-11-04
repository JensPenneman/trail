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
    vi.restoreAllMocks();
  });

  it("runs an hour of playback per second at 1 h/s", () => {
    render(<Harness />);
    act(() => {
      controls().setRate(60);
      controls().enter(tue, at(tue, 10));
    });
    const start = read().clock;
    act(() => vi.advanceTimersByTime(1000));
    // An hour a second, give or take the last frame not yet due.
    expect(read().clock - start).toBeGreaterThan(3400);
    expect(read().clock - start).toBeLessThanOrEqual(3600);
  });

  it("updates at most 30 times a second on a 60 Hz display, evenly", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(performance, "now").mockReturnValue(0);
    render(<Harness />);
    act(() => controls().enter(tue, at(tue, 10)));
    const times: number[] = [];
    let last = read().clock;
    for (let frame = 1; frame <= 60; frame += 1) {
      const timestamp = (frame * 1000) / 60;
      act(() => callbacks.at(-1)?.(timestamp));
      if (read().clock !== last) {
        times.push(timestamp);
        last = read().clock;
      }
    }
    expect(times.length).toBeLessThanOrEqual(30);
    expect(times.length).toBeGreaterThanOrEqual(29);
    // Every second frame, not now two and now three.
    const gaps = times.slice(1).map((time, index) => Math.round(time - (times[index] ?? 0)));
    expect(new Set(gaps).size).toBe(1);
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

  it("leaves exactly one clock running, and none after it is unmounted", () => {
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    const { unmount } = render(<Harness />);
    act(() => controls().enter(tue, at(tue, 10)));
    act(() => controls().pause());
    act(() => controls().play());
    act(() => vi.advanceTimersByTime(500));
    const running = read().clock;
    // Pausing and playing again did not start a second clock: a second adds one second's worth.
    act(() => vi.advanceTimersByTime(1000));
    expect(read().clock - running).toBeGreaterThan(0.9 * 300);
    expect(read().clock - running).toBeLessThanOrEqual(300);
    unmount();
    expect(cancel).toHaveBeenCalled();
    const frozen = latest?.state.clock;
    act(() => vi.advanceTimersByTime(2000));
    expect(latest?.state.clock).toBe(frozen);
  });

  it("goes through a day without moves, cached already, to the move of the day after", () => {
    // Tuesday has moves; Wednesday is cached and has none; Thursday's tracks are not in yet.
    const days = [tue, "2026-11-04", thu];
    const world: PlaybackWorld = { ...baseWorld, days, loaded: (day) => day !== thu };
    const thursdayMoves = [{ from: at(thu, 7), to: at(thu, 8) }];
    const { rerender } = render(<Harness world={world} />);
    act(() => controls().enter(tue, at(tue, 6)));
    act(() => controls().pause());
    act(() => controls().seek(at(tue, 18, 30)));
    act(() => controls().stepMove(1));
    // Wednesday is in and has no move after the clock: the press goes on by itself, and waits
    // for Thursday's tracks.
    expect(read().day).toBe(thu);
    rerender(<Harness world={{ ...world, loaded: () => true, moves: thursdayMoves }} />);
    expect(read().clock).toBe(at(thu, 7));
  });

  it("finishes a step to another day's move once that day is in", () => {
    const moves = [{ from: at(thu, 7), to: at(thu, 8) }];
    // Thursday's tracks are not in yet: the step waits for them.
    const waiting = { ...baseWorld, moves: [], loaded: (day: string) => day !== thu };
    const { rerender } = render(<Harness world={waiting} />);
    act(() => controls().enter(tue, at(tue, 6)));
    act(() => controls().pause());
    act(() => controls().seek(at(tue, 18, 30)));
    act(() => controls().stepMove(1));
    expect(read()).toMatchObject({ day: thu, clock: at(thu, 0) });
    // The next day's moves reach the page: the press lands on the first of them.
    rerender(<Harness world={{ ...baseWorld, moves }} />);
    expect(read().clock).toBe(at(thu, 7));
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

  it("let Space and Escape through from the bar's own range, radios and switch, but not their own keys", () => {
    started();
    const range = document.createElement("input");
    range.type = "range";
    const radio = document.createElement("input");
    radio.type = "radio";
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.append(range, radio, box);
    press(range, { key: " " });
    expect(read().status).toBe("playing");
    press(range, { key: "ArrowRight" });
    press(radio, { key: " " });
    press(box, { key: " " });
    expect(read().status).toBe("playing");
    press(radio, { key: "Escape" });
    expect(read().status).toBe("off");
    range.remove();
    radio.remove();
    box.remove();
  });

  it("take a held Space or Escape for one press", () => {
    started();
    press(document.body, { key: " ", repeat: true });
    expect(read().status).toBe("paused");
    press(document.body, { key: " " });
    press(document.body, { key: " ", repeat: true });
    expect(read().status).toBe("playing");
    press(document.body, { key: "Escape", repeat: true });
    expect(read().status).toBe("playing");
  });

  it("leave alone editable text and alert dialogs", () => {
    const clock = started();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "plaintext-only");
    const alert = document.createElement("div");
    alert.setAttribute("role", "alertdialog");
    document.body.append(editable, alert);
    press(editable, { key: "ArrowRight" });
    press(alert, { key: "Escape" });
    expect(read()).toMatchObject({ status: "paused", clock });
    editable.remove();
    alert.remove();
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
