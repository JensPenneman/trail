import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InsightsModePage } from "../src/pages/insights/InsightsModePage";
import { InsightsOverviewPage } from "../src/pages/insights/InsightsOverviewPage";
import { InsightsRoadsPage } from "../src/pages/insights/InsightsRoadsPage";
import { InsightsTimePage } from "../src/pages/insights/InsightsTimePage";
import { addDays } from "../src/time/addDays";
import { localDateOf } from "../src/time/localDateOf";
import { user } from "./support/fixtures";
import {
  modeInsights,
  overview,
  roadInsights,
  segmentId,
  timeInsights,
} from "./support/insightsFixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

const today = () => localDateOf(Date.now(), "Europe/Brussels");

/** The query of the last request to `path`. */
function lastQuery(calls: ReturnType<typeof mockApi>["calls"], path: string): URLSearchParams {
  const call = calls.filter((entry) => entry.path === path).at(-1);
  return new URL(call?.url ?? "http://localhost/").searchParams;
}

describe("the Insights overview", () => {
  it("shows the totals against the period before, the modes and their table", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": { status: 200, body: overview() },
    });
    renderPage(<InsightsOverviewPage />, { path: "/insights", user });

    expect(await screen.findByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
    const tiles = await screen.findByRole("group", { name: "Totals" });
    expect(within(tiles).getByText("66.0 km")).toBeVisible();
    // 66 km against 60 km, two moves against one.
    expect(within(tiles).getByText("10% more than the 7 days before")).toBeVisible();
    // Moves and active days: two of each against one.
    expect(within(tiles).getAllByText("1 more than the 7 days before")).toHaveLength(2);
    expect(within(tiles).getByText("of 7 days")).toBeVisible();

    const breakdown = screen.getByRole("figure", { name: "Distance by mode" });
    expect(breakdown).toHaveAccessibleDescription("Train: most of the distance, 91% (60.0 km).");
    expect(within(breakdown).getByRole("img", { name: "Train" })).toBeInTheDocument();
    const series = screen.getByRole("figure", { name: "Distance per day, by mode" });
    expect(within(series).getAllByRole("img")).toHaveLength(7);
    expect(within(series).getByRole("list", { name: "Legend" })).toHaveTextContent(
      /Cycling.*Train/,
    );

    const table = screen.getByRole("table", { name: "Modes of the period" });
    const train = within(table).getByRole("link", { name: "Train" });
    expect(train).toHaveAttribute("href", "/insights/transport/train");
    expect(within(table).getByText("+5.0 km")).toBeVisible();

    // The last 30 days by default, in the account's zone.
    const query = lastQuery(calls, "/api/v1/insights/overview");
    expect(query.get("to")).toBe(today());
    expect(query.get("from")).toBe(addDays(today(), -29));
  });

  it("follows the period and the devices chosen, in the address", async () => {
    const browser = userEvent.setup();
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": { status: 200, body: overview() },
    });
    const { router } = renderPage(<InsightsOverviewPage />, { path: "/insights", user });
    await screen.findByRole("group", { name: "Totals" });

    await browser.click(screen.getByRole("radio", { name: "7 days" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=7d"));
    await waitFor(() =>
      expect(lastQuery(calls, "/api/v1/insights/overview").get("from")).toBe(addDays(today(), -6)),
    );

    await browser.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() =>
      expect(lastQuery(calls, "/api/v1/insights/overview").has("from")).toBe(false),
    );

    // Two devices: the filter offers both; switching one off asks for the other only.
    const devices = await screen.findByRole("group", { name: "Devices" });
    await browser.click(within(devices).getByRole("checkbox", { name: "iPhone 16" }));
    await waitFor(() => expect(router.state.location.search).toMatch(/devices=/));
    const asked = lastQuery(calls, "/api/v1/insights/overview").get("devices");
    expect(asked).not.toBeNull();
    expect(asked?.split(",")).toHaveLength(1);
  });

  it("takes a custom period of at most three years", async () => {
    const browser = userEvent.setup();
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": { status: 200, body: overview() },
    });
    const { router } = renderPage(<InsightsOverviewPage />, { path: "/insights", user });
    await screen.findByRole("group", { name: "Totals" });
    await browser.click(screen.getByRole("radio", { name: "Custom" }));
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    await browser.clear(from);
    await browser.type(from, "2019-01-01");
    await browser.clear(to);
    await browser.type(to, "2026-10-26");
    await browser.click(screen.getByRole("button", { name: "Show" }));
    expect(await screen.findByText("A period can span at most three years.")).toBeVisible();

    await browser.clear(from);
    await browser.type(from, "2026-10-01");
    await browser.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() =>
      expect(router.state.location.search).toBe("?from=2026-10-01&to=2026-10-26"),
    );
    await waitFor(() => {
      const query = lastQuery(calls, "/api/v1/insights/overview");
      expect([query.get("from"), query.get("to")]).toEqual(["2026-10-01", "2026-10-26"]);
    });
    expect(screen.getByRole("radio", { name: "Custom" })).toBeChecked();
  });

  it("says so while processing catches up, and when there were no moves", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": {
        status: 200,
        body: overview({
          pending: true,
          modes: [],
          series: [],
          totals: { distanceM: 0, durationS: 0, moves: 0, stops: 0, activeDays: 0 },
        }),
      },
    });
    renderPage(<InsightsOverviewPage />, { path: "/insights", user, url: "/insights?period=all" });
    expect(await screen.findByText("Processing is still catching up")).toBeVisible();
    expect(screen.getByRole("heading", { name: "No moves in this period" })).toBeVisible();
    // All of the history has nothing before it to compare with.
    expect(screen.queryByText(/than the/)).toBeNull();
  });
});

describe("a mode's page", () => {
  it("shows the mode's tiles, rails, top moves with a link to the map, and speeds", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/modes/train": { status: 200, body: modeInsights() },
    });
    renderPage(<InsightsModePage />, {
      path: "/insights/transport/:mode",
      url: "/insights/transport/train?period=7d",
      user,
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Train" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Insights" })).toHaveAttribute(
      "href",
      "/insights?period=7d",
    );
    const [tiles] = await screen.findAllByRole("group", { name: "Totals" });
    if (tiles === undefined) throw new Error("no tiles");
    // The distance, and the longest move, which is the only one.
    expect(within(tiles).getAllByText("60.0 km")).toHaveLength(2);
    expect(within(tiles).getByText("96 km/h")).toBeVisible();

    const rails = screen.getByRole("group", { name: "On the rails" });
    expect(within(rails).getByText("96%")).toBeVisible();
    expect(within(rails).getByText("3 a ride")).toBeVisible();

    const link = screen.getByRole("link", { name: /^Show on the map/ });
    expect(link).toHaveAttribute("href", `/?view=history&date=2026-10-21&segment=${segmentId}`);
    expect(screen.getByRole("figure", { name: "Moves by speed" })).toBeVisible();
    expect(screen.getByRole("figure", { name: "Time by hour of the day" })).toBeVisible();
    expect(screen.getByRole("figure", { name: "Distance per day" })).toBeVisible();
    expect(lastQuery(calls, "/api/v1/insights/modes/train").get("from")).toBe(addDays(today(), -6));
  });

  it("names no mode that does not exist, and asks for nothing", async () => {
    const { calls } = mockApi(standardRoutes());
    renderPage(<InsightsModePage />, {
      path: "/insights/transport/:mode",
      url: "/insights/transport/teleport",
      user,
    });
    expect(await screen.findByRole("heading", { name: "No such mode" })).toBeVisible();
    expect(calls.some((call) => call.path.startsWith("/api/v1/insights"))).toBe(false);
  });

  it("shows roads for road modes and says when there is no map data", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/modes/cycling": {
        status: 200,
        body: modeInsights({
          mode: "cycling",
          rail: null,
          stationStops: null,
          roads: { distanceM: 6000, mappedM: 0, kinds: [] },
        }),
      },
    });
    renderPage(<InsightsModePage />, {
      path: "/insights/transport/:mode",
      url: "/insights/transport/cycling",
      user,
    });
    expect(await screen.findByRole("heading", { level: 2, name: "Roads" })).toBeVisible();
    expect(screen.getByText("No map data for these moves")).toBeVisible();
    expect(screen.queryByRole("group", { name: "On the rails" })).toBeNull();
  });
});

describe("when you travel", () => {
  it("draws the hours of the week, for every mode or the one chosen", async () => {
    const browser = userEvent.setup();
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/time": ({ url }) => ({
        status: 200,
        body: timeInsights({
          mode: url.searchParams.get("mode") === "cycling" ? "cycling" : null,
        }),
      }),
    });
    const { router } = renderPage(<InsightsTimePage />, { path: "/insights/time", user });
    const grid = await screen.findByRole("figure", {
      name: "Time on the move by weekday and hour",
    });
    expect(grid).toHaveAccessibleDescription(
      "Most often on Wednesday at 08:00 (45 mins); 1 hr 15 mins on the move in all.",
    );
    expect(within(grid).getByRole("img", { name: "Wednesday, 08:00–09:00" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "When you travel" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const mode = screen.getByRole("combobox", { name: "Mode" });
    expect(
      within(mode)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All modes", "Cycling", "Train"]);
    await browser.selectOptions(mode, "cycling");
    await waitFor(() => expect(router.state.location.search).toBe("?mode=cycling"));
    await waitFor(() =>
      expect(lastQuery(calls, "/api/v1/insights/time").get("mode")).toBe("cycling"),
    );
    expect(
      await screen.findByRole("figure", { name: "Time by cycling by weekday and hour" }),
    ).toBeVisible();
  });
});

describe("roads", () => {
  it("lists the kinds and groups of ways, with the share of each", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/roads": { status: 200, body: roadInsights() },
    });
    renderPage(<InsightsRoadsPage />, { path: "/insights/roads", user });
    const kinds = await screen.findByRole("figure", { name: "Distance by kind of way" });
    expect(within(kinds).getByRole("img", { name: "Railways" })).toHaveAccessibleDescription(
      "57.6 km · 87%",
    );
    expect(screen.getByRole("figure", { name: "Distance by group of ways" })).toBeVisible();
  });

  it("says when the moves have no map data", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/roads": {
        status: 200,
        body: roadInsights({ mappedM: 0, kinds: [], families: [] }),
      },
    });
    renderPage(<InsightsRoadsPage />, { path: "/insights/roads", user });
    expect(await screen.findByText("No map data for these moves")).toBeVisible();
  });
});
