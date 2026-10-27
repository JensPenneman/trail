import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProcessingLevel } from "@trail/contracts/transport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { applyServerEvent } from "../src/live/applyServerEvent";
import { createLiveStore } from "../src/live/createLiveStore";
import { DevicePage } from "../src/pages/device/DevicePage";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { automatic, car, ids, levelTracks, timeline, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

describe("the Transport level on History", () => {
  it("draws stops and moves by mode, with a legend and the day's timeline", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=history", user });
    const level = screen.getByRole("group", { name: "Detail of the tracks" });
    expect(within(level).getByRole("radio", { name: "Transport" })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /Map of the tracks/ })).toHaveAttribute(
        "data-transport",
        "2",
      ),
    );
    const legend = screen.getByRole("region", { name: "Map legend" });
    expect(within(legend).getByText("Train")).toBeInTheDocument();
    expect(within(legend).getByText("Unsure: worth a look")).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Timeline" });
    expect(await within(list).findByText(/Train · 31\.2 km/)).toBeInTheDocument();
    expect(within(list).getByText("unsure")).toBeInTheDocument();
    expect(within(list).getByText(/Stop · 1 hr/)).toBeInTheDocument();
  });

  it("keeps the level in the URL and remembers it", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: "/?view=history", user });
    await person.click(screen.getByRole("radio", { name: "Raw" }));
    expect(router.state.location.search).toBe("?view=history&level=raw");
    expect(window.localStorage.getItem("trail.level")).toBe("raw");
    const map = () => screen.getByRole("img", { name: /^Map/ });
    await waitFor(() => expect(map()).toHaveAttribute("data-transport", "0"));
    expect(map()).toHaveAttribute("data-tracks", "1");
  });

  it("opens a move, confirms or changes its mode, and resets it", async () => {
    let current = timeline(new Date().toISOString())[1];
    const api = mockApi({
      ...standardRoutes(),
      [`PUT /api/v1/segments/${ids.train}/mode`]: ({ body }) => {
        const mode = (body as { mode: "bus" }).mode;
        if (current !== undefined)
          current = { ...current, mode, modeUser: mode, needsReview: false };
        return { status: 200, body: { segment: current } };
      },
      [`DELETE /api/v1/segments/${ids.train}/mode`]: () => {
        if (current !== undefined) current = { ...current, mode: "train", modeUser: null };
        return { status: 200, body: { segment: current } };
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history", user });
    await person.click(await screen.findByRole("button", { name: /Details of the train/ }));
    const dialog = await screen.findByRole("dialog", { name: "Train" });
    expect(within(dialog).getByText("Was this a train ride?")).toBeInTheDocument();
    expect(within(dialog).getByText("55%")).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: "Bus" }));
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ mode: "bus" });
    expect(await within(dialog).findByText("Saved: Bus.")).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: "Yes, train" }));
    expect(api.calls.filter((call) => call.method === "PUT").at(-1)?.body).toEqual({
      mode: "train",
    });
  });
});

describe("continuity at the Transport level", () => {
  /** The fixture's day, with the phone silent for 42 minutes after the train and a walk after. */
  function withGap(from: string) {
    const [stop, train] = timeline(from);
    if (stop === undefined || train === undefined) throw new Error("no timeline in the fixture");
    const resumed = Date.parse(train.endedAt) + 42 * 60_000;
    const walk = {
      ...train,
      id: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d47",
      mode: "walking" as const,
      modeInferred: "walking" as const,
      needsReview: false,
      startedAt: new Date(resumed).toISOString(),
      endedAt: new Date(resumed + 600_000).toISOString(),
      durationS: 600,
      distanceM: 800,
    };
    return [{ ...stop, spreadM: 120 }, train, walk];
  }

  it("says when the phone recorded nothing between two segments, and how long", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/segments": ({ url }: { url: URL }) => ({
        status: 200,
        body: {
          items: withGap(url.searchParams.get("from") ?? new Date().toISOString()),
          nextCursor: null,
          pending: false,
        },
      }),
    });
    renderPage(<PeoplePage />, { url: "/?view=history", user });
    const list = screen.getByRole("region", { name: "Timeline" });
    expect(await within(list).findByText(/^No data · 42 min/)).toBeInTheDocument();
    // Between the train and the walk (with their times), and nowhere else.
    const rows = [...list.querySelectorAll("li")].map((row) => row.textContent ?? "");
    expect(rows.findIndex((row) => row.startsWith("No data"))).toBe(2);
    expect(rows.filter((row) => row.startsWith("No data"))).toHaveLength(1);
    expect(rows[2]).toMatch(/07:38 – 08:20$/);
  });

  it("tells in a stop's details how far one moved within it", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/segments": ({ url }: { url: URL }) => ({
        status: 200,
        body: {
          items: withGap(url.searchParams.get("from") ?? new Date().toISOString()),
          nextCursor: null,
          pending: false,
        },
      }),
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history", user });
    await person.click(await screen.findByRole("button", { name: /Details of the stop/ }));
    const dialog = await screen.findByRole("dialog", { name: "Stop" });
    expect(within(dialog).getByText("Moved within")).toBeInTheDocument();
    expect(within(dialog).getByText("120 m")).toBeInTheDocument();
    expect(within(dialog).getByText("Duration")).toBeInTheDocument();
  });

  it("explains the dotted path within a stop and the connector across a gap", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/tracks": ({ url }: { url: URL }) => {
        const response = levelTracks(
          url.searchParams.get("from") ?? new Date().toISOString(),
          url.searchParams.get("to") ?? new Date().toISOString(),
          (url.searchParams.get("level") ?? "raw") as ProcessingLevel,
        );
        if (response.level !== "inferred") return { status: 200, body: response };
        const [stop, move] = response.segments;
        if (stop === undefined || move === undefined) return { status: 200, body: response };
        const end = move.points.at(-1) ?? [0, 0, 0];
        // The stop spreads 120 m, ending where the move starts; the phone resumes 700 m on,
        // an hour after the move.
        const [lon = 0, lat = 0, t = 0] = stop.points[0] ?? [];
        const spread = {
          ...stop,
          points: [
            [lon + 0.0017, lat, t - 60],
            [lon, lat, t],
          ] as [number, number, number][],
        };
        const later = {
          ...move,
          id: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d46",
          points: [
            [end[0], end[1] + 0.0063, end[2] + 3600],
            [end[0], end[1] + 0.01, end[2] + 3900],
          ] as [number, number, number][],
        };
        return { status: 200, body: { ...response, segments: [spread, move, later] } };
      },
    });
    renderPage(<PeoplePage />, { url: "/?view=history", user });
    // The map is handed the connector too: the stop, two moves and the gap between them.
    await waitFor(() =>
      expect(document.querySelector("[data-transport]")).toHaveAttribute("data-transport", "4"),
    );
    const legend = screen.getByText("Moved within a stop").closest("section");
    expect(legend).toHaveAccessibleName("Map legend");
    expect(
      within(legend as HTMLElement).getByText("No data: a gap in the recording"),
    ).toBeInTheDocument();
  });
});

describe("a link to one move", () => {
  it("opens its details on its day, and closing them drops the link", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: `/?view=history&segment=${ids.train}`,
      user,
    });
    const dialog = await screen.findByRole("dialog", { name: "Train" });
    expect(within(dialog).getByText("Was this a train ride?")).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(router.state.location.search).toBe("?view=history"));
    expect(screen.queryByRole("dialog", { name: "Train" })).toBeNull();
  });
});

describe("the quick toggle on the Me card", () => {
  it("sets the mode of the device that reported last from now on, and Auto again", async () => {
    let mode = automatic;
    const api = mockApi({
      ...standardRoutes(),
      [`GET /api/v1/devices/${ids.phone}/mode`]: () => ({ status: 200, body: { mode } }),
      [`POST /api/v1/devices/${ids.phone}/mode`]: ({ body }) => {
        const chosen = (body as { mode: "train" | null }).mode;
        mode =
          chosen === null
            ? automatic
            : {
                override: {
                  id: "019a2000-0000-7000-8000-000000000001",
                  deviceId: ids.phone,
                  kind: "toggle",
                  mode: chosen,
                  from: new Date().toISOString(),
                  until: null,
                  source: "ui",
                  createdAt: new Date().toISOString(),
                },
                current: {
                  mode: chosen,
                  setByUser: true,
                  since: new Date().toISOString(),
                  segmentId: null,
                },
              };
        return { status: 200, body: { mode } };
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const me = screen.getByRole("region", { name: "Me" });
    const chips = await within(me).findByRole("group", { name: "Now:" });
    expect(
      await within(chips).findByRole("button", { name: "Auto", pressed: true }),
    ).toBeInTheDocument();
    await person.click(within(chips).getByRole("button", { name: "Train" }));
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({ mode: "train" });
    expect(
      await within(chips).findByRole("button", { name: "Train", pressed: true }),
    ).toBeInTheDocument();
    await person.click(within(chips).getByRole("button", { name: "Other" }));
    expect(
      await screen.findByRole("dialog", { name: "How are you travelling?" }),
    ).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Boat" }));
    expect(api.calls.filter((call) => call.method === "POST").at(-1)?.body).toEqual({
      mode: "boat",
    });
    await person.click(within(chips).getByRole("button", { name: /^Other/ }));
    await person.keyboard("{Escape}");
    await person.click(within(chips).getByRole("button", { name: "Auto" }));
    expect(api.calls.filter((call) => call.method === "POST").at(-1)?.body).toEqual({ mode: null });
    // Every press went to the phone, the device that reported last.
    expect(api.calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(
      Array(3).fill(`/api/v1/devices/${ids.phone}/mode`),
    );
  });

  it("says what Me is doing from the mode it sets", async () => {
    const train = {
      override: null,
      current: { mode: "train", setByUser: true, since: new Date().toISOString(), segmentId: null },
    };
    mockApi({
      ...standardRoutes(),
      [`GET /api/v1/devices/${ids.phone}/mode`]: { status: 200, body: { mode: train } },
    });
    renderPage(<PeoplePage />, { user });
    const me = screen.getByRole("region", { name: "Me" });
    // The phone stands still at the station: a train, as the toggle says, without a speed.
    expect(await within(me).findByText("By train")).toBeInTheDocument();
  });

  it("is on each device's page too, for that device", async () => {
    const api = mockApi({
      ...standardRoutes(),
      [`GET /api/devices/${ids.car}`]: { status: 200, body: { device: car() } },
      [`POST /api/v1/devices/${ids.car}/mode`]: { status: 200, body: { mode: automatic } },
    });
    const person = userEvent.setup();
    renderPage(<DevicePage />, { path: "/devices/:deviceId", url: `/devices/${ids.car}`, user });
    const section = await screen.findByRole("region", { name: "Travelling now" });
    const chips = within(section).getByRole("group", { name: "Now:" });
    await person.click(await within(chips).findByRole("button", { name: "Car" }));
    expect(api.calls.find((call) => call.method === "POST")?.path).toBe(
      `/api/v1/devices/${ids.car}/mode`,
    );
  });
});

describe("segments events", () => {
  it("refetch the tracks at a level, the timeline and the device's mode", () => {
    const queryClient = new QueryClient();
    const range = {
      from: "2026-09-29T22:00:00.000Z",
      to: "2026-09-30T22:00:00.000Z",
      deviceIds: null,
    };
    for (const key of [
      queryKeys.levelTracks({ ...range, level: "inferred" }),
      queryKeys.timeline(range),
      queryKeys.deviceMode(ids.phone),
    ]) {
      queryClient.setQueryData(key, { cached: true });
    }
    applyServerEvent(queryClient, createLiveStore(), {
      type: "segments",
      deviceId: ids.phone,
      from: range.from,
      to: range.to,
    });
    for (const key of [
      queryKeys.levelTracks({ ...range, level: "inferred" }),
      queryKeys.timeline(range),
      queryKeys.deviceMode(ids.phone),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
