import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";
import { dayBounds } from "../src/pages/map/history/playback/playbackModel";
import type { PlaybackState } from "../src/pages/map/history/playback/playbackReducer";
import { initialPlayback } from "../src/pages/map/history/playback/playbackReducer";
import { usePlaybackAnnouncer } from "../src/pages/map/history/playback/usePlaybackAnnouncer";
import { usePlaybackDays } from "../src/pages/map/history/playback/usePlaybackDays";
import { usePlaybackPrefetch } from "../src/pages/map/history/playback/usePlaybackPrefetch";
import type { PersonDays } from "../src/queries/usePersonDays";
import { useTransportMap } from "../src/transport/useTransportMap";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

const zone = "Europe/Brussels";
/** The announcer's own delay between a message and its being spoken (AnnouncerProvider). */
const announcerDelayMs = 60;
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
  startDay?: string;
  playingDay?: string;
  today?: string;
}) {
  const days = usePlaybackDays({
    active: props.active ?? true,
    startDay: props.startDay ?? "2026-11-01",
    playingDay: props.playingDay ?? "2026-11-01",
    today: props.today ?? "2026-11-05",
    source: props.source,
  });
  return (
    <p data-testid="days">
      {JSON.stringify({ days: days.days, complete: days.complete, last: [...days.lastAt] })}
    </p>
  );
}

const shown = () => JSON.parse(screen.getByTestId("days").textContent ?? "{}");

function Prefetch({
  clock,
  moves = [],
  skipStops = false,
  person = false,
}: {
  clock: number;
  moves?: readonly { from: number; to: number }[];
  skipStops?: boolean;
  person?: boolean;
}) {
  const { nextDay } = usePlaybackPrefetch({
    active: true,
    day: "2026-11-03",
    clock,
    days: ["2026-11-03", "2026-11-05"],
    timeZone: zone,
    level: "inferred",
    moves,
    skipStops,
    me: person ? null : { deviceIds: null },
    personRequest: person
      ? (range) => ({ userId: ids.ana, ...range, deviceIds: [ids.anaPhone], share: "s:7" })
      : null,
  });
  return <p data-testid="next">{nextDay ?? "none"}</p>;
}

function Announcer({ state }: { state: PlaybackState }) {
  usePlaybackAnnouncer(state);
  return null;
}

describe("the days playback can visit", () => {
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

describe("the days of a long stretch", () => {
  const dayRow = (date: string, at: number) => ({
    date,
    deviceId: ids.phone,
    points: 3,
    distanceM: 1,
    firstAt: iso(at - 100),
    lastAt: iso(at),
  });
  const me = { kind: "me", deviceIds: null } as const;

  it("move on to a window of their own when no later day is left in the one in hand, keeping the earlier days", async () => {
    // 400 days from 2025-01-01 end in February 2026; today is later, so the list is not complete.
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/stats/days": ({ url }: { url: URL }) => ({
        status: 200,
        body: {
          timezone: zone,
          days:
            url.searchParams.get("from") === "2025-01-01"
              ? [dayRow("2025-01-01", 1000), dayRow("2025-03-01", 2000)]
              : [dayRow("2025-03-01", 2000), dayRow("2026-03-01", 9000)],
        },
      }),
    });
    renderPage(
      <Steps
        steps={[
          <Days
            key="x"
            source={me}
            startDay="2025-01-01"
            playingDay="2025-01-01"
            today="2026-11-05"
          />,
          <Days
            key="x"
            source={me}
            startDay="2025-01-01"
            playingDay="2025-03-01"
            today="2026-11-05"
          />,
        ]}
      />,
      { user },
    );
    await waitFor(() => expect(shown().days).toEqual(["2025-01-01", "2025-03-01"]));
    expect(shown().complete).toBe(false);
    await next();
    // Nothing is left after 2025-03-01 in the first window: the next one starts after it.
    await waitFor(() =>
      expect(
        api.calls.some((c) => new URL(c.url ?? "").searchParams.get("from") === "2026-02-05"),
      ).toBe(true),
    );
    await waitFor(() => expect(shown().days).toEqual(["2025-01-01", "2025-03-01", "2026-03-01"]));
  });

  it("go on through empty windows until today, so that a history that ended long ago ends", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/stats/days": { status: 200, body: { timezone: zone, days: [] } },
    });
    // 2024: three windows of 400 days reach 2026-11-05; the data (none) ended before the first.
    renderPage(
      <Steps
        steps={[
          <Days
            key="x"
            source={me}
            startDay="2024-01-01"
            playingDay="2024-01-01"
            today="2026-11-05"
          />,
          <Days
            key="x"
            source={me}
            startDay="2024-01-01"
            playingDay="2024-01-01"
            today="2026-11-05"
          />,
          <Days
            key="x"
            source={me}
            startDay="2024-01-01"
            playingDay="2024-01-01"
            today="2026-11-05"
          />,
        ]}
      />,
      { user },
    );
    await waitFor(() => expect(shown().complete).toBe(true));
    const froms = api.calls
      .filter((c) => c.path === "/api/stats/days")
      .map((c) => new URL(c.url ?? "").searchParams.get("from"));
    // Each window starts the day after the one before ended.
    expect(froms).toEqual(["2024-01-01", "2025-02-04", "2026-03-11"]);
  });

  it("are none, and not complete, while another set of devices has not answered", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockApi({
      ...standardRoutes(),
      "GET /api/stats/days": async ({ url }: { url: URL }) => {
        const other = url.searchParams.get("deviceIds") === ids.car;
        if (other) await gate;
        return {
          status: 200,
          body: { timezone: zone, days: other ? [] : [dayRow("2026-11-01", 500)] },
        };
      },
    });
    renderPage(
      <Steps
        steps={[
          <Days key="x" source={me} />,
          <Days key="x" source={{ kind: "me", deviceIds: [ids.car] }} />,
        ]}
      />,
      { user },
    );
    await waitFor(() => expect(shown().days).toEqual(["2026-11-01"]));
    await next();
    // Until the other set answers, the earlier answer is not its days.
    expect(shown().days).toEqual([]);
    expect(shown().complete).toBe(false);
    act(() => release());
    await waitFor(() => expect(shown().complete).toBe(true));
    expect(shown().days).toEqual([]);
  });

  it("take the latest of a sharer's rows for a day, one per device", () => {
    mockApi(standardRoutes());
    renderPage(
      <Days
        source={{
          kind: "person",
          days: {
            days: [
              { date: "2026-11-02", lastAt: iso(900) },
              { date: "2026-11-02", lastAt: iso(300) },
            ],
            complete: true,
          },
        }}
      />,
      { user },
    );
    expect(shown().last).toEqual([["2026-11-02", 900]]);
  });
});

describe("loading ahead for the other cases", () => {
  const { start, end } = dayBounds("2026-11-03", zone);

  it("starts at once for a day without moves when stops are skipped", async () => {
    mockApi(standardRoutes());
    renderPage(<Prefetch clock={start + 3600} moves={[]} skipStops />, { user });
    await waitFor(() => expect(screen.getByTestId("next")).toHaveTextContent("2026-11-05"));
  });

  it("starts once no move is left in the day when stops are skipped, and only then", async () => {
    const api = mockApi(standardRoutes());
    const moves = [{ from: start + 8 * 3600, to: start + 9 * 3600 }];
    renderPage(
      <Steps
        steps={[
          <Prefetch key="x" clock={start + 8.5 * 3600} moves={moves} skipStops />,
          <Prefetch key="x" clock={start + 9.5 * 3600} moves={moves} skipStops />,
          <Prefetch key="x" clock={start + 9.5 * 3600} moves={moves} />,
        ]}
      />,
      { user },
    );
    expect(screen.getByTestId("next")).toHaveTextContent("none");
    await next();
    await waitFor(() => expect(screen.getByTestId("next")).toHaveTextContent("2026-11-05"));
    expect(api.calls.some((c) => c.path === "/api/tracks")).toBe(true);
    // Without skipping, a quiet evening is waited through to 90 % of the day.
    await next();
    expect(screen.getByTestId("next")).toHaveTextContent("none");
  });

  it("asks for a sharer's track of the next day, and none of one's own", async () => {
    const api = mockApi({
      ...standardRoutes(),
      [`GET /api/v1/people/${ids.ana}/track`]: {
        status: 200,
        body: { from: iso(0), to: iso(1), tracks: [] },
      },
    });
    renderPage(<Prefetch clock={start + (end - start) * 0.95} person />, { user });
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === `/api/v1/people/${ids.ana}/track`)).toBe(true),
    );
    const asked = api.calls.find((c) => c.path === `/api/v1/people/${ids.ana}/track`)?.url ?? "";
    expect(new URL(asked).searchParams.get("from")).toBe(iso(dayBounds("2026-11-05", zone).start));
    expect(api.calls.some((c) => c.path === "/api/tracks")).toBe(false);
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
    // The announcer speaks 60 ms after a message: well past that, still nothing for a same-day step.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3 * announcerDelayMs));
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
      await new Promise((resolve) => setTimeout(resolve, 3 * announcerDelayMs));
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
