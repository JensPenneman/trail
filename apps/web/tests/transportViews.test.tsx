import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { applyServerEvent } from "../src/live/applyServerEvent";
import { createLiveStore } from "../src/live/createLiveStore";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { automatic, ids, timeline, user } from "./support/fixtures";
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

describe("a link to one move", () => {
  it("opens its details on its day, and closing them drops the link", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: `/?view=history&segment=${ids.train}`,
      user,
    });
    const dialog = await screen.findByRole("dialog", { name: "Train" }, { timeout: 5000 });
    expect(within(dialog).getByText("Was this a train ride?")).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(router.state.location.search).toBe("?view=history"));
    expect(screen.queryByRole("dialog", { name: "Train" })).toBeNull();
  });
});

describe("the quick toggle on Live", () => {
  it("sets the mode from now on and hands it back to Auto", async () => {
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
    const card = await screen.findByRole("article", { name: "iPhone 16" });
    const chips = within(card).getByRole("group", { name: "Now:" });
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
      await screen.findByRole("dialog", { name: "How is iPhone 16 travelling?" }),
    ).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Boat" }));
    expect(api.calls.filter((call) => call.method === "POST").at(-1)?.body).toEqual({
      mode: "boat",
    });
    await person.click(within(chips).getByRole("button", { name: /^Other/ }));
    await person.keyboard("{Escape}");
    await person.click(within(chips).getByRole("button", { name: "Auto" }));
    expect(api.calls.filter((call) => call.method === "POST").at(-1)?.body).toEqual({ mode: null });
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
