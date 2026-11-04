import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { basemapMissingNotice } from "../src/map/useMapStyle";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { paramsOf } from "./support/addressParams";
import { config, ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const map = () => screen.getByRole("img", { name: /^(Map|Heatmap)\b/ });
const view = (name: string) =>
  within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name });

describe("the People page, Live", () => {
  it("shows where everyone is now, and in Me's detail where you have been today", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?person=me", user });
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    expect(view("Live")).toBeChecked();
    expect(screen.getByText(/^Where you are now · /)).toBeInTheDocument();
    // Everyone's position stays on the map: two devices of one's own, Ana's and bob's.
    expect(await screen.findByRole("img", { name: /^Map of your track today/ })).toHaveAttribute(
      "data-positions",
      "4",
    );
    expect(map()).toHaveAccessibleName(/where everyone is now: you, Ana Bell and bob\./);

    // Today's stops and moves, in Me's detail under their name.
    const today = await screen.findByRole("region", { name: "Your day so far" });
    const me = screen.getByRole("region", { name: "Me" });
    expect(me).toContainElement(today);
    const timeline = within(today).getByRole("region", { name: "Timeline" });
    expect(await within(timeline).findByText(/^Train · 31\.2 km/)).toBeInTheDocument();
    // With two devices, each stop and move says whose it is.
    expect(within(timeline).getAllByText(/^iPhone 16 · /)).toHaveLength(2);
    // A move opens its details and moves the camera to it.
    await person.click(within(timeline).getByRole("button", { name: /^Details of the train/ }));
    expect(await screen.findByRole("dialog", { name: "Train" })).toBeInTheDocument();
    expect(map().getAttribute("data-focus")).toMatch(new RegExp(`^segment:${ids.train}#`));

    // What the devices send is Settings › Devices'.
    expect(screen.queryByRole("article", { name: "iPhone 16" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Uploads" })).toBeNull();
    expect(screen.queryByText(/devices? live/)).toBeNull();
    expect(document.title).toBe("Live · People · Trail");
  });

  it("invites to add a first device when there are none", async () => {
    mockApi({ ...standardRoutes(), "GET /api/devices": { status: 200, body: { devices: [] } } });
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByText("Connect your first phone")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Me/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a device" })).toHaveAttribute(
      "href",
      "/settings/devices?add=1",
    );
  });

  it("offers a retry when the devices cannot be loaded", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": {
        status: 503,
        body: { error: { code: "unavailable", message: "Database down" } },
      },
    });
    renderPage(<PeoplePage />, { user });
    const list = screen.getByRole("list", { name: "People" });
    expect(await within(list).findByText("Your devices could not be loaded")).toBeInTheDocument();
    expect(within(list).getByText("Database down")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("asks for nothing another view needs", async () => {
    const api = mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?person=me", user });
    await screen.findByText(/^Train · 31\.2 km/);
    const paths = api.calls.map((call) => call.path);
    for (const path of [
      "/api/heatmap",
      "/api/visits",
      "/api/trips",
      "/api/stats/days",
      // Settings › Devices': the uploads and the hours of activity.
      "/api/stats/activity",
      `/api/devices/${ids.phone}/ingest-log`,
    ]) {
      expect(paths, path).not.toContain(path);
    }
  });
});

describe("the People page, History", () => {
  it("shows the day's totals, visits, trips and a time slider for Me", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=history&person=me", user });
    expect(view("History")).toBeChecked();
    expect(await screen.findByText("1.3 km")).toBeInTheDocument();
    expect(screen.getByText(/3 points/)).toBeInTheDocument();
    expect(await screen.findByRole("slider", { name: "Position at" })).toBeInTheDocument();
    expect(await screen.findByText(/Bike ride · 8\.4 km/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Show this visit on the map/ })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Devices" })).toBeInTheDocument();
    expect(document.title).toBe("History · People · Trail");
  });

  it("moves between days and opens the calendar", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=history&date=2026-09-12",
      user,
    });
    await person.click(screen.getByRole("button", { name: "Previous day" }));
    expect(router.state.location.search).toBe("?view=history&date=2026-09-11");
    await person.click(screen.getByRole("button", { name: /choose another day/ }));
    expect(await screen.findByRole("grid", { name: "September 2026" })).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: /Thursday, 10 September 2026/ }));
    expect(router.state.location.search).toBe("?view=history&date=2026-09-10");
  });

  it("keeps the date popover open while the day becomes a period, and shows the period form", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=history&date=2026-09-12",
      user,
    });
    const date = screen.getByRole("button", { name: /choose another day/ });
    await person.click(date);
    await person.click(screen.getByRole("radio", { name: "Period" }));
    expect(router.state.location.search).toContain("from=");
    // The same popover, now with the form; focus stays on the radio that was pressed.
    expect(await screen.findByRole("button", { name: "Show" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Period" })).toHaveFocus();
    expect(screen.getByRole("button", { name: /choose another day/ })).toBe(date);
  });

  it("closes the popover when a period is applied, with focus on the date button", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=history&from=2026-09-01&to=2026-09-07",
      user,
    });
    await person.click(await screen.findByRole("button", { name: /1 Sept – .*7 Sept/ }));
    await person.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(router.state.location.search).toContain("from=");
    expect(screen.queryByRole("radio", { name: "Period" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose another day|–/ })).toHaveFocus();
  });

  it("closes the popover when a day is picked, with focus on the date button", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&date=2026-09-12", user });
    await person.click(screen.getByRole("button", { name: /choose another day/ }));
    await person.click(await screen.findByRole("button", { name: /Thursday, 10 September 2026/ }));
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose another day/ })).toHaveFocus();
  });

  it("opens the calendar from an empty day with focus on the day shown", async () => {
    const empty = ({ url }: { url: URL }) => {
      const from = url.searchParams.get("from") ?? "2026-09-12T00:00:00Z";
      const to = url.searchParams.get("to") ?? "2026-09-13T00:00:00Z";
      return { from, to };
    };
    mockApi({
      ...standardRoutes(),
      "GET /api/tracks": (request: { url: URL }) => ({
        status: 200,
        body: { ...empty(request), tracks: [] },
      }),
      "GET /api/v1/tracks": (request: { url: URL }) => ({
        status: 200,
        body: { ...empty(request), level: "raw", segments: [] },
      }),
      "GET /api/v1/segments": {
        status: 200,
        body: { items: [], nextCursor: null, pending: false },
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&person=me&date=2026-09-12", user });
    await person.click(await screen.findByRole("button", { name: "Find a day with data" }));
    const day = await screen.findByRole("button", { name: /Saturday, 12 September 2026/ });
    expect(day).toHaveAttribute("aria-pressed", "true");
    expect(day).toHaveFocus();
  });

  it("shows a period from a deep link", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=history&from=2026-09-01&to=2026-09-07", user });
    const date = await screen.findByRole("button", { name: /1 Sept – .*7 Sept/ });
    expect(screen.queryByRole("radio", { name: "Period" })).not.toBeInTheDocument();
    await userEvent.setup().click(date);
    expect(screen.getByRole("radio", { name: "Period" })).toBeChecked();
  });
});

describe("the People page, Heat", () => {
  it("summarises everything recorded and hands the heatmap its place", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=heat", user });
    expect(view("Heat")).toBeChecked();
    // 184,322 + 41,207 points over both devices.
    expect(await screen.findByText("225,529")).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: /Heatmap of all recorded points/ }),
    ).toBeInTheDocument();
    // The key of the squares' colours, from the cells in view (both busy: one class).
    const legend = await screen.findByRole("list", { name: "Points recorded in each square" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["6,400 or more"]);
    // The level of the tracks has nothing to say about a heatmap.
    expect(screen.queryByRole("group", { name: "Detail of the tracks" })).not.toBeInTheDocument();
    expect(document.title).toBe("Heatmap · People · Trail");
  });
});

describe("switching views", () => {
  it("keeps the one map, the device selection and the other views' parameters", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?devices=${ids.phone}`, user });
    // A device filter from a device's page selects its owner.
    const canvas = await screen.findByRole("img", { name: /^Map of your track today/ });
    await waitFor(() => expect(canvas).toHaveAttribute("data-positions", "3"));

    await person.click(view("History"));
    // The view and the person the link implied are written by two effects: exactly these three
    // parameters, in whatever order they land.
    await waitFor(() =>
      expect(paramsOf(router.state.location.search)).toEqual([
        ["devices", ids.phone],
        ["person", "me"],
        ["view", "history"],
      ]),
    );
    expect(await screen.findByRole("slider", { name: "Position at" })).toBeInTheDocument();
    expect(map()).toBe(canvas);
    await person.click(screen.getByRole("button", { name: "Previous day" }));

    await person.click(view("Heat"));
    expect(await screen.findByText("184,322")).toBeInTheDocument();
    expect(map()).toBe(canvas);
    await waitFor(() => expect(map()).toHaveAttribute("data-heat", "2"));

    await person.click(view("Live"));
    // Live is the default view and leaves the address; the day and the filter stay.
    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get("view")).toBeNull();
      expect(params.get("date")).not.toBeNull();
      expect(params.get("devices")).toBe(ids.phone);
    });
    expect(await screen.findByRole("region", { name: "Your day so far" })).toBeInTheDocument();
    expect(map()).toBe(canvas);
    expect(map()).toHaveAttribute("data-positions", "3");
  });

  it("frames another person, day or set of devices anew, and the same again the same way", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    const canvas = await screen.findByRole("img", { name: /^Map of where everyone is now/ });
    await waitFor(() => expect(canvas).not.toHaveAttribute("data-fit", ""));
    const overview = canvas.getAttribute("data-fit");
    expect(overview).toMatch(/^live\|everyone\|/);
    await person.click(await screen.findByRole("link", { name: /^Me/ }));
    await waitFor(() => expect(map().getAttribute("data-fit")).toMatch(/^live\|me\|/));
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(map().getAttribute("data-fit")).toBe(overview));
    await person.click(view("History"));
    await screen.findByRole("img", { name: /^Map of the tracks for/ });
    const today = map().getAttribute("data-fit");
    await person.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(map().getAttribute("data-fit")).not.toBe(today));
  });

  it("never makes History's camera move again after another view moved the camera", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&person=me", user });
    await person.click(await screen.findByRole("button", { name: /Show this visit on the map/ }));
    expect(map().getAttribute("data-focus")).toMatch(/^visit:/);
    await person.click(view("Live"));
    const day = await screen.findByRole("region", { name: "Your day so far" });
    await person.click(await within(day).findByRole("button", { name: /^Details of the train/ }));
    await person.keyboard("{Escape}");
    expect(map().getAttribute("data-focus")).toMatch(/^segment:/);
    await person.click(view("History"));
    expect(map()).toHaveAttribute("data-focus", "");
    // Nor after another day from History's own controls.
    await person.click(await screen.findByRole("button", { name: /Show this visit on the map/ }));
    expect(map().getAttribute("data-focus")).toMatch(/^visit:/);
    await person.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(map()).toHaveAttribute("data-focus", ""));
  });

  it("falls back to Live for a view it does not know", () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=explore", user });
    expect(view("Live")).toBeChecked();
  });
});

describe("the device filter", () => {
  it("is folded away among the options, and narrows every view to the devices chosen", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: "/?person=me", user });
    const advanced = (await screen.findByText("Advanced")).closest("details");
    if (advanced === null) throw new Error("No Advanced in Map options");
    expect(advanced).not.toHaveAttribute("open");
    // Which devices draw is not worth a word of the summary while all of them do.
    expect(screen.queryByText(/\d of \d devices/)).not.toBeInTheDocument();
    await person.click(screen.getByText("Advanced"));
    const filter = await within(advanced).findByRole("group", { name: "Devices" });
    await person.click(within(filter).getByRole("checkbox", { name: "Car" }));
    expect(router.state.location.search).toBe(`?person=me&devices=${ids.phone}`);
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "3"));
    expect(screen.getByText(/1 of 2 devices/)).toBeInTheDocument();
    expect(within(filter).getByRole("checkbox", { name: "iPhone 16" })).toBeDisabled();
    await person.click(within(filter).getByRole("checkbox", { name: "Car" }));
    expect(router.state.location.search).toBe("?person=me");
  });
});

describe("the map style", () => {
  it("follows the system, or the choice remembered on this browser", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    const control = screen.getByRole("group", { name: "Map style" });
    expect(within(control).getByRole("radio", { name: "Auto" })).toBeChecked();
    expect(within(control).queryByRole("radio", { name: "Satellite" })).not.toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /^Map/ })).toHaveAttribute(
      "data-style",
      config.mapStyles.light,
    );
    await person.click(within(control).getByRole("radio", { name: "Dark" }));
    expect(router.state.location.search).toBe("?style=dark");
    expect(window.localStorage.getItem("trail.mapStyle")).toBe("dark");
    expect(map()).toHaveAttribute("data-style", config.mapStyles.dark);
    expect(map()).toHaveAttribute("data-dark", "true");
  });

  it("offers satellite imagery when the server has it, and draws for its dark ground", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/config": {
        status: 200,
        body: {
          ...config,
          mapStyles: {
            ...config.mapStyles,
            satellite: {
              kind: "raster",
              tiles: "https://imagery.example.com/{z}/{x}/{y}.jpg",
              attribution: "Imagery <b>Example</b>",
            },
          },
        },
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const control = screen.getByRole("group", { name: "Map style" });
    await person.click(await within(control).findByRole("radio", { name: "Satellite" }));
    expect(map()).toHaveAttribute("data-style", "document");
    expect(map()).toHaveAttribute("data-dark", "true");
  });

  it("draws the server's own basemap from its paths, and says when it has none yet", async () => {
    const own = { light: "/map/styles/light.json", dark: "/map/styles/dark.json" };
    mockApi({
      ...standardRoutes(),
      "GET /api/config": {
        status: 200,
        body: { ...config, mapStyles: { ...own, basemap: "self" } },
      },
    });
    const first = renderPage(<PeoplePage />, { user });
    expect(await screen.findByRole("img", { name: /^Map/ })).toHaveAttribute(
      "data-style",
      own.light,
    );
    expect(map()).toHaveAttribute("data-notice", "");
    first.unmount();

    mockApi({
      ...standardRoutes(),
      "GET /api/config": {
        status: 200,
        body: {
          ...config,
          mapStyles: {
            ...own,
            basemap: "none",
            satellite: { kind: "style", url: "https://imagery.example.com/style.json" },
          },
        },
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByRole("img", { name: /^Map/ })).toHaveAttribute(
      "data-notice",
      basemapMissingNotice,
    );
    // Satellite imagery is a basemap of its own: no notice over it.
    const control = screen.getByRole("group", { name: "Map style" });
    await person.click(await within(control).findByRole("radio", { name: "Satellite" }));
    expect(map()).toHaveAttribute("data-notice", "");
  });

  it("falls back to Auto where satellite imagery is not configured", async () => {
    window.localStorage.setItem("trail.mapStyle", "satellite");
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    const control = screen.getByRole("group", { name: "Map style" });
    expect(await within(control).findByRole("radio", { name: "Auto" })).toBeChecked();
    expect(await screen.findByRole("img", { name: /^Map/ })).toHaveAttribute(
      "data-style",
      config.mapStyles.light,
    );
  });
});
