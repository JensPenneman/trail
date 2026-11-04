import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";
import { dayBounds } from "../src/pages/map/history/playback/playbackModel";
import type { PlaybackState } from "../src/pages/map/history/playback/playbackReducer";
import { initialPlayback } from "../src/pages/map/history/playback/playbackReducer";
import { usePlaybackAnnouncer } from "../src/pages/map/history/playback/usePlaybackAnnouncer";
import {
  type PersonDays,
  usePlaybackDays,
} from "../src/pages/map/history/playback/usePlaybackDays";
import { usePlaybackPrefetch } from "../src/pages/map/history/playback/usePlaybackPrefetch";
import { useTransportMap } from "../src/transport/useTransportMap";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

const zone = "Europe/Brussels";
/** Renders `steps[0]`, then each next one when "Next" is pressed: a rerender inside the providers. */
function Steps({ steps }: { steps: readonly ReactNode[] }) {
  const [index, setIndex] = useState(0);
  return (
    <>
      {steps[index]}
      <button type="button" onClick={() => setIndex((current) => current + 1)}>
        Next
      </button>
    </>
  );
}
const next = () => userEvent.setup().click(screen.getByRole("button", { name: "Next" }));

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

function Days(props: {
  source: Parameters<typeof usePlaybackDays>[0]["source"];
  active?: boolean;
}) {
  const days = usePlaybackDays({
    active: props.active ?? true,
    startDay: "2026-11-01",
    playingDay: "2026-11-01",
    today: "2026-11-05",
    source: props.source,
  });
  return (
    <p data-testid="days">
      {JSON.stringify({ days: days.days, complete: days.complete, last: [...days.lastAt] })}
    </p>
  );
}

function Prefetch({ clock }: { clock: number }) {
  const { nextDay } = usePlaybackPrefetch({
    active: true,
    day: "2026-11-03",
    clock,
    days: ["2026-11-03", "2026-11-05"],
    timeZone: zone,
    level: "inferred",
    me: { deviceIds: null },
    personRequest: null,
  });
  return <p data-testid="next">{nextDay ?? "none"}</p>;
}

function Announcer({ state }: { state: PlaybackState }) {
  usePlaybackAnnouncer(state);
  return null;
}

describe("the days playback can visit", () => {
  const shown = () => JSON.parse(screen.getByTestId("days").textContent ?? "{}");

  it("come from the stats for oneself: days with points, the last point of each, from the start day", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/stats/days": {
        status: 200,
        body: {
          timezone: zone,
          days: [
            {
              date: "2026-11-01",
              deviceId: ids.phone,
              points: 12,
              distanceM: 1,
              firstAt: iso(100),
              lastAt: iso(500),
            },
            {
              date: "2026-11-01",
              deviceId: ids.car,
              points: 3,
              distanceM: 1,
              firstAt: iso(100),
              lastAt: iso(900),
            },
            {
              date: "2026-11-03",
              deviceId: ids.phone,
              points: 0,
              distanceM: 0,
              firstAt: iso(100),
              lastAt: iso(100),
            },
            {
              date: "2026-11-04",
              deviceId: ids.phone,
              points: 5,
              distanceM: 1,
              firstAt: iso(1000),
              lastAt: iso(2000),
            },
          ],
        },
      },
    });
    renderPage(<Days source={{ kind: "me", deviceIds: null }} />, { user });
    await waitFor(() => expect(shown().days).toEqual(["2026-11-01", "2026-11-04"]));
    expect(shown().last).toEqual([
      ["2026-11-01", 900],
      ["2026-11-04", 2000],
    ]);
    expect(shown().complete).toBe(true);
    const call = api.calls.find((entry) => entry.path === "/api/stats/days");
    const query = new URL(call?.url ?? "").searchParams;
    expect(query.get("from")).toBe("2026-11-01");
    expect(query.get("to")).toBe("2026-11-05");
  });

  it("are the sharer's own answer, handed in, for someone else — and ask nothing", () => {
    const api = mockApi(standardRoutes());
    const answer: PersonDays = {
      days: [
        { date: "2026-11-04", lastAt: iso(2000) },
        { date: "2026-11-02", lastAt: iso(800) },
      ],
      complete: false,
    };
    renderPage(<Days source={{ kind: "person", days: answer }} />, { user });
    expect(shown()).toEqual({
      days: ["2026-11-02", "2026-11-04"],
      complete: false,
      last: [
        ["2026-11-04", 2000],
        ["2026-11-02", 800],
      ],
    });
    expect(api.calls.some((entry) => entry.path === "/api/stats/days")).toBe(false);
  });

  it("ask for nothing while no player is on", () => {
    const api = mockApi(standardRoutes());
    renderPage(<Days active={false} source={{ kind: "me", deviceIds: null }} />, { user });
    expect(shown().days).toEqual([]);
    expect(api.calls.some((entry) => entry.path === "/api/stats/days")).toBe(false);
  });
});

describe("loading the next day ahead", () => {
  const { start, end } = dayBounds("2026-11-03", zone);

  it("waits for 90 % of the day, then mounts the next day's tracks, levels, timeline and visits", async () => {
    const api = mockApi(standardRoutes());
    renderPage(
      <Steps
        steps={[
          <Prefetch key="x" clock={start + (end - start) * 0.89} />,
          <Prefetch key="x" clock={start + (end - start) * 0.9} />,
        ]}
      />,
      { user },
    );
    expect(screen.getByTestId("next")).toHaveTextContent("none");
    expect(api.calls.filter((c) => /tracks|segments|visits/.test(c.path))).toEqual([]);
    await next();
    await waitFor(() => expect(screen.getByTestId("next")).toHaveTextContent("2026-11-05"));
    await waitFor(() => {
      const paths = new Set(api.calls.map((c) => c.path));
      for (const path of ["/api/tracks", "/api/v1/tracks", "/api/v1/segments", "/api/visits"]) {
        expect(paths.has(path), path).toBe(true);
      }
    });
    const asked = api.calls.find((c) => c.path === "/api/tracks")?.url ?? "";
    const from = new URL(asked).searchParams.get("from");
    expect(from).toBe(iso(dayBounds("2026-11-05", zone).start));
  });
});

describe("what a screen reader is told", () => {
  const playing = (day: string, clock: number, status: PlaybackState["status"] = "playing") => ({
    ...initialPlayback,
    status,
    day,
    clock,
  });

  it("says the day when playback reaches another, and the end", async () => {
    const last = dayBounds("2026-11-05", zone).start + 15 * 3600 + 120;
    renderPage(
      <Steps
        steps={[
          <Announcer key="x" state={playing("2026-11-03", 1)} />,
          <Announcer key="x" state={playing("2026-11-03", 100)} />,
          <Announcer key="x" state={playing("2026-11-05", 200)} />,
          <Announcer key="x" state={playing("2026-11-05", last, "ended")} />,
        ]}
      />,
      { user },
    );
    await next();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await next();
    expect(await screen.findByText("Thursday, 5 November 2026")).toBeInTheDocument();
    await next();
    expect(
      await screen.findByText(
        "Playback ended at the last recorded point, 15:02, Thursday, 5 November 2026",
      ),
    ).toBeInTheDocument();
  });

  it("says the end once, not again for the same end", async () => {
    renderPage(
      <Steps
        steps={[
          <Announcer key="x" state={playing("2026-11-03", 1)} />,
          <Announcer key="x" state={playing("2026-11-03", 5, "ended")} />,
          <Announcer key="x" state={playing("2026-11-03", 6, "ended")} />,
        ]}
      />,
      { user },
    );
    await next();
    await screen.findByText(/^Playback ended/);
    await next();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(screen.getAllByText(/^Playback ended/)).toHaveLength(1);
  });
});

function Transport({ until }: { until?: number }) {
  const range = {
    from: "2026-09-29T22:00:00.000Z",
    to: "2026-09-30T22:00:00.000Z",
    deviceIds: null,
  };
  const map = useTransportMap(range, "inferred", [], { dark: false, device: () => "#d" }, until);
  return (
    <p data-testid="transport">
      {map.transport
        .map((segment) => `${segment.kind}${segment.dimmed === true ? ":dimmed" : ""}`)
        .join(",")}
    </p>
  );
}

describe("the transport map up to the cursor", () => {
  it("dims what lies after `until`, and nothing without it", async () => {
    mockApi(standardRoutes());
    renderPage(<Steps steps={[<Transport key="x" />, <Transport key="x" until={1} />]} />, {
      user,
    });
    await waitFor(() => expect(screen.getByTestId("transport").textContent).toMatch(/^stop,move/));
    expect(screen.getByTestId("transport").textContent).not.toContain("dimmed");
    // Before the day's first point everything is ahead.
    await next();
    await waitFor(() =>
      expect(screen.getByTestId("transport").textContent).toContain("stop:dimmed"),
    );
  });
});
