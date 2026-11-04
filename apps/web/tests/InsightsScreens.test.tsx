import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { addDays } from "../src/time/addDays";
import { localDateOf } from "../src/time/localDateOf";
import { shiftMonth } from "../src/time/shiftMonth";
import { holdAll, seedEntry, warmClient } from "./support/cacheHarness";
import { device, ids, user } from "./support/fixtures";
import {
  modeInsights,
  monthPeriod,
  octoberOverview,
  overview,
  placeAnswer,
  placeKeys,
  placesAnswer,
  roadInsights,
  segmentId,
  septemberOverview,
  timeInsights,
} from "./support/insightsFixtures";
import { mockApi } from "./support/mockApi";
import { renderInsights } from "./support/renderInsights";
import { createTestQueryClient } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

const today = () => localDateOf(Date.now(), "Europe/Brussels");

/** The queries of the requests to `path`, in order. */
function queriesOf(calls: ReturnType<typeof mockApi>["calls"], path: string): URLSearchParams[] {
  return calls
    .filter((entry) => entry.path === path)
    .map((entry) => new URL(entry.url ?? "http://localhost/").searchParams);
}

const lastQuery = (calls: ReturnType<typeof mockApi>["calls"], path: string): URLSearchParams =>
  queriesOf(calls, path).at(-1) ?? new URLSearchParams();

/** October for the days from October, September for the days before (the comparison). */
const overviewRoute = ({ url }: { url: URL }) => ({
  status: 200,
  body: url.searchParams.get("from")?.startsWith("2026-09")
    ? septemberOverview()
    : octoberOverview(),
});

const octoberRoutes = () => ({
  ...standardRoutes(),
  "GET /api/v1/insights/overview": overviewRoute,
});

const hero = async () => {
  const [tiles] = await screen.findAllByRole("group", { name: "Totals" });
  if (tiles === undefined) throw new Error("no hero");
  return tiles;
};

describe("the summary", () => {
  it("shows the distance of the month against the month before, and the modes by day", async () => {
    const { calls } = mockApi(octoberRoutes());
    renderInsights("/insights?period=2026-10");

    expect(await screen.findByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
    const tiles = await hero();
    expect(within(tiles).getByText("66.0 km")).toBeVisible();
    expect(within(tiles).getByText("1 hr 15 mins on the move · 2 moves")).toBeVisible();
    expect(await within(tiles).findByText("10% more than September")).toBeVisible();

    const series = screen.getByRole("figure", { name: "Distance per day, by mode" });
    expect(within(series).getAllByRole("img")).toHaveLength(31);
    expect(within(series).getByRole("list", { name: "Legend" })).toHaveTextContent(
      /Cycling.*Train/,
    );
    // One chart, of distance only: no switch and no second figure.
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    expect(screen.queryByRole("figure", { name: "Distance by mode" })).toBeNull();

    // The month, then the whole month before for the comparison.
    const asked = queriesOf(calls, "/api/v1/insights/overview").map((query) => [
      query.get("from"),
      query.get("to"),
    ]);
    expect(asked).toContainEqual(["2026-10-01", "2026-10-31"]);
    expect(asked).toContainEqual(["2026-09-01", "2026-09-30"]);
    expect(asked).toHaveLength(2);
  });

  it("compares the month that goes on with the same days of the month before", async () => {
    const first = `${today().slice(0, 7)}-01`;
    const before = shiftMonth(first, -1);
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": ({ url }) => ({
        status: 200,
        body: url.searchParams.get("from") === before ? septemberOverview() : octoberOverview(),
      }),
    });
    renderInsights("/insights");
    const tiles = await hero();
    expect(await within(tiles).findByText(/^10% more than the same days of /)).toBeVisible();
    const query = queriesOf(calls, "/api/v1/insights/overview").find(
      (entry) => entry.get("from") === before,
    );
    expect(query?.get("to")?.slice(0, 7)).toBe(before.slice(0, 7));
    // The first call asks for the days up to today.
    expect(
      queriesOf(calls, "/api/v1/insights/overview").some(
        (entry) => entry.get("from") === first && entry.get("to") === today(),
      ),
    ).toBe(true);
  });

  it("says when nothing was recorded in the month before, without an arrow", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": ({ url }) => ({
        status: 200,
        body: url.searchParams.get("from")?.startsWith("2026-09")
          ? septemberOverview({
              modes: [],
              totals: { distanceM: 0, durationS: 0, moves: 0, stops: 0, activeDays: 0 },
            })
          : octoberOverview(),
      }),
    });
    renderInsights("/insights?period=2026-10");
    expect(await screen.findByText("Nothing recorded in September to compare with.")).toBeVisible();
    expect(screen.queryByText(/more than|less than/)).toBeNull();
  });

  it("compares all of the history with nothing, and a custom range with the days before it", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": ({ url }) => ({
        status: 200,
        body: url.searchParams.has("from") ? overview() : octoberOverview(),
      }),
    });
    const all = renderInsights("/insights?period=all");
    expect(await within(await hero()).findByText("66.0 km")).toBeVisible();
    expect(screen.queryByText(/than/)).toBeNull();
    expect(queriesOf(calls, "/api/v1/insights/overview")).toHaveLength(1);
    // Where it begins: the first day of the answer.
    expect(within(await hero()).getByText(/ · since 1 Oct 2026$/)).toBeVisible();
    expect(lastQuery(calls, "/api/v1/insights/overview").has("from")).toBe(false);
    all.unmount();

    // The API's own previous period: as many days just before.
    renderInsights("/insights?from=2026-10-20&to=2026-10-26");
    expect(await screen.findByText("10% more than the 7 days before")).toBeVisible();
  });

  it("says so while processing catches up, and when there were no moves", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": {
        status: 200,
        body: octoberOverview({
          pending: true,
          modes: [],
          series: [],
          totals: { distanceM: 0, durationS: 0, moves: 0, stops: 0, activeDays: 0 },
        }),
      },
    });
    renderInsights("/insights?period=2026-10");
    expect(await screen.findByText("Processing is still catching up")).toBeVisible();
    expect(screen.getByRole("heading", { name: "No moves in October 2026" })).toBeVisible();
    // The patterns stay, the modes have none.
    expect(screen.getByRole("link", { name: "When you travel" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Modes" })).toBeNull();
  });

  it("asks for the summary again when it fails", async () => {
    const browser = userEvent.setup();
    let failing = true;
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": () =>
        failing ? { status: 500, body: {} } : { status: 200, body: octoberOverview() },
    });
    renderInsights("/insights?period=all");
    expect(await screen.findByText("Insights could not be loaded")).toBeVisible();
    failing = false;
    await browser.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await within(await hero()).findByText("66.0 km")).toBeVisible();
  });

  it("sets the tab's title", async () => {
    mockApi(octoberRoutes());
    renderInsights("/insights?period=2026-10");
    await screen.findByRole("heading", { level: 1, name: "Insights" });
    await waitFor(() => expect(document.title).toBe("Insights · Trail"));
  });
});

describe("the list of screens", () => {
  it("is part of the summary on a phone: modes with their part of the distance, then the patterns", async () => {
    mockApi(octoberRoutes());
    renderInsights("/insights?period=2026-10&devices=");
    const nav = await screen.findByRole("navigation", { name: "Insights" });
    expect(await within(nav).findByRole("heading", { level: 2, name: "Modes" })).toBeVisible();
    expect(within(nav).getByRole("heading", { level: 2, name: "Patterns" })).toBeVisible();
    // The order is the distance: train before cycling.
    const modes = within(within(nav).getByRole("list", { name: "Modes" })).getAllByRole("link");
    expect(modes.map((link) => link.textContent)).toEqual([
      expect.stringMatching(/^Train/),
      expect.stringMatching(/^Cycling/),
    ]);
    expect(within(nav).getByRole("link", { name: "Train 60.0 km · 91%" })).toHaveAttribute(
      "href",
      "/insights/transport/train?period=2026-10",
    );
    expect(within(nav).getByRole("link", { name: "When you travel" })).toHaveAttribute(
      "href",
      "/insights/time?period=2026-10",
    );
    expect(within(nav).queryByRole("link", { name: /^Summary/ })).toBeNull();
  });

  it("stands beside every screen on a wide screen, with the summary as a row and the page current", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/modes/train": {
        status: 200,
        body: modeInsights({ period: monthPeriod("2026-10") }),
      },
    });
    renderInsights("/insights/transport/train?period=2026-10", { wide: true });
    const nav = await screen.findByRole("navigation", { name: "Insights" });
    // The summary's row gets its distance when the overview is there.
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: /^Summary/ })).toHaveTextContent("66.0 km"),
    );
    expect(within(nav).getByRole("link", { name: /^Train/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Beside the screens the groups are labels, not headings.
    expect(within(nav).queryByRole("heading")).toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "Train" })).toBeVisible();
  });

  it("hands focus to the title of the screen opened from the list beside it, whichever way", async () => {
    const browser = userEvent.setup();
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/modes/train": {
        status: 200,
        body: modeInsights({ period: monthPeriod("2026-10") }),
      },
    });
    renderInsights("/insights?period=2026-10", { wide: true });
    const nav = await screen.findByRole("navigation", { name: "Insights" });
    await browser.click(await within(nav).findByRole("link", { name: /^Train/ }));
    const train = await screen.findByRole("heading", { level: 1, name: "Train" });
    await waitFor(() => expect(train).toHaveFocus());

    // Back to the summary by its row: the title of the summary, not the row of the mode left.
    await browser.click(within(nav).getByRole("link", { name: /^Summary/ }));
    const summary = await screen.findByRole("heading", { level: 1, name: "Insights" });
    await waitFor(() => expect(summary).toHaveFocus());
    expect(within(nav).getByRole("link", { name: /^Train/ })).not.toHaveFocus();
  });

  it("marks the summary and the patterns as current, and a mode without moves as none", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/modes/walking": {
        status: 200,
        body: modeInsights({
          mode: "walking",
          period: monthPeriod("2026-10"),
          totals: {
            distanceM: 0,
            durationS: 0,
            moves: 0,
            avgSpeedKmh: 0,
            typicalSpeedKmh: null,
            longest: null,
            fastest: null,
          },
        }),
      },
    });
    const view = renderInsights("/insights?period=2026-10", { wide: true });
    const nav = await screen.findByRole("navigation", { name: "Insights" });
    expect(await within(nav).findByRole("link", { name: /^Summary/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await view.router.navigate("/insights/time?period=2026-10");
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: "When you travel" })).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );
    await view.router.navigate("/insights/transport/walking?period=2026-10");
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: "Walking None" })).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );
  });
});

describe("the period", () => {
  it("is chosen in units, each a step back can undo, around the same day", async () => {
    const browser = userEvent.setup();
    mockApi(octoberRoutes());
    const { router } = renderInsights("/insights?period=2025-06");
    await hero();
    const units = screen.getByRole("group", { name: "Period" });
    expect(
      within(units)
        .getAllByRole("radio")
        .map((radio) => radio.parentElement?.textContent),
    ).toEqual(["Week", "Month", "Year", "All"]);
    expect(within(units).getByRole("radio", { name: "Month" })).toBeChecked();

    await browser.click(within(units).getByRole("radio", { name: "Week" }));
    // The week the month ends in.
    await waitFor(() => expect(router.state.location.search).toBe("?period=2025-W27"));
    expect(router.state.historyAction).toBe("PUSH");
    expect(
      await screen.findByRole("button", { name: "30 Jun – 6 Jul 2025, choose a custom period" }),
    ).toBeVisible();

    await browser.click(within(units).getByRole("radio", { name: "Year" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=2025"));
    await browser.click(within(units).getByRole("radio", { name: "All" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=all"));
    // All of the history has no steps.
    expect(screen.queryByRole("button", { name: /^(Previous|Next) / })).toBeNull();
  });

  it("steps to the period before and after, replacing the entry, and stops at the present", async () => {
    const browser = userEvent.setup();
    mockApi(octoberRoutes());
    const { router } = renderInsights("/insights?period=2026-10");
    await hero();
    await browser.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=2026-09"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(
      await screen.findByRole("button", { name: "September 2026, choose a custom period" }),
    ).toBeVisible();
    await browser.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=2026-10"));

    // The month that goes on is the default: its address says nothing, and there is no next.
    await router.navigate("/insights");
    const next = screen.getByRole("button", { name: "Next month" });
    await waitFor(() => expect(next).toHaveAttribute("aria-disabled", "true"));
    await browser.click(next);
    expect(router.state.location.search).toBe("");
    await browser.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(`?period=${shiftMonth(today(), -1).slice(0, 7)}`),
    );
  });

  it("opens the old rolling periods as custom ranges, without steps", async () => {
    const { calls } = mockApi(octoberRoutes());
    renderInsights("/insights?period=7d");
    await hero();
    expect(lastQuery(calls, "/api/v1/insights/overview").get("from")).toBe(addDays(today(), -6));
    expect(screen.queryByRole("button", { name: /^(Previous|Next) / })).toBeNull();
    expect(screen.getByRole("group", { name: "Period" })).toBeVisible();
    for (const radio of within(screen.getByRole("group", { name: "Period" })).getAllByRole(
      "radio",
    )) {
      expect(radio).not.toBeChecked();
    }
  });

  it("takes a custom period of at most three years, in a popover Escape closes", async () => {
    const browser = userEvent.setup();
    const { calls } = mockApi(octoberRoutes());
    const { router } = renderInsights("/insights?period=2026-10");
    await hero();
    const label = screen.getByRole("button", { name: "October 2026, choose a custom period" });
    expect(label).toHaveAttribute("aria-expanded", "false");
    await browser.click(label);
    expect(label).toHaveAttribute("aria-expanded", "true");
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    expect(from).toHaveValue("2026-10-01");
    expect(to).toHaveValue("2026-10-31");
    await browser.clear(from);
    await browser.type(from, "2019-01-01");
    await browser.click(screen.getByRole("button", { name: "Show" }));
    expect(await screen.findByText("A period can span at most three years.")).toBeVisible();

    await browser.clear(from);
    await browser.type(from, "2026-10-06");
    await browser.clear(to);
    await browser.type(to, "2026-10-26");
    await browser.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() =>
      expect(router.state.location.search).toBe("?from=2026-10-06&to=2026-10-26"),
    );
    await waitFor(() => {
      const query = lastQuery(calls, "/api/v1/insights/overview");
      expect([query.get("from"), query.get("to")]).toEqual(["2026-10-06", "2026-10-26"]);
    });
    // Shown, the popover is closed and focus is back on its button.
    const shown = await screen.findByRole("button", {
      name: "6–26 Oct 2026, choose a custom period",
    });
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(shown).toHaveFocus();

    await browser.click(shown);
    expect(screen.getByLabelText("From")).toBeVisible();
    await browser.keyboard("{Escape}");
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(shown).toHaveFocus();
  });

  it("counts the devices chosen under Options, Advanced, and says how many", async () => {
    const browser = userEvent.setup();
    const { calls } = mockApi(octoberRoutes());
    const { router } = renderInsights("/insights?period=2026-10");
    await hero();
    const options = await screen.findByRole("button", { name: "Options" });
    expect(screen.queryByRole("group", { name: "Devices" })).toBeNull();
    await browser.click(options);
    await browser.click(screen.getByRole("button", { name: "Advanced" }));
    const devices = screen.getByRole("group", { name: "Devices" });
    await browser.click(within(devices).getByRole("checkbox", { name: "iPhone 16" }));
    await waitFor(() => expect(router.state.location.search).toMatch(/devices=/));
    expect(router.state.historyAction).toBe("REPLACE");
    await waitFor(() =>
      expect(lastQuery(calls, "/api/v1/insights/overview").get("devices")?.split(",")).toHaveLength(
        1,
      ),
    );
    expect(screen.getByRole("button", { name: "Options 1 of 2 devices" })).toBeVisible();
  });

  it("opens Advanced at once while a device filter is on, and keeps focus on the step it took", async () => {
    const browser = userEvent.setup();
    mockApi(octoberRoutes());
    const { router } = renderInsights(`/insights?period=2026-10&devices=${ids.phone}`);
    await hero();
    await browser.click(await screen.findByRole("button", { name: "Options 1 of 2 devices" }));
    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("group", { name: "Devices" })).toBeVisible();

    // A step changes the screen's numbers, not where focus is.
    const previous = screen.getByRole("button", { name: "Previous month" });
    await browser.click(previous);
    await waitFor(() => expect(router.state.location.search).toMatch(/period=2026-09/));
    await screen.findByRole("button", { name: "September 2026, choose a custom period" });
    expect(previous).toHaveFocus();
  });

  it("announces a new period once its answer is there, and nothing at opening or on a refetch", async () => {
    const browser = userEvent.setup();
    let more = 0;
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": ({ url }) => {
        const september = url.searchParams.get("from")?.startsWith("2026-09") === true;
        const body = september ? septemberOverview() : octoberOverview();
        return {
          status: 200,
          body: { ...body, totals: { ...body.totals, distanceM: body.totals.distanceM + more } },
        };
      },
    });
    const { queryClient } = renderInsights("/insights?period=2026-10");
    const status = screen.getByRole("status");
    const heard: string[] = [];
    new MutationObserver(() => heard.push(status.textContent ?? "")).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    await hero();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(heard).toEqual([]);

    await browser.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(status).toHaveTextContent("September 2026: 60.0 km"));

    // The same period again, with other numbers: said nothing more.
    heard.length = 0;
    more = 5000;
    await queryClient.invalidateQueries({ queryKey: ["insights"] });
    await within(await hero()).findByText("65.0 km");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(heard).toEqual([]);
  });

  it("has no options with a single device", async () => {
    const standard = standardRoutes();
    mockApi({
      ...standard,
      "GET /api/devices": { status: 200, body: { devices: [device()] } },
      "GET /api/v1/insights/overview": overviewRoute,
    });
    renderInsights("/insights?period=2026-10");
    await hero();
    expect(screen.queryByRole("button", { name: /^Options/ })).toBeNull();
  });
});

describe("a mode's screen", () => {
  const trainRoutes = () => ({
    ...octoberRoutes(),
    "GET /api/v1/insights/modes/train": {
      status: 200,
      body: modeInsights({ period: monthPeriod("2026-10") }),
    },
    "GET /api/v1/insights/modes/cycling": {
      status: 200,
      body: modeInsights({
        mode: "cycling",
        period: monthPeriod("2026-10"),
        totals: {
          distanceM: 6000,
          durationS: 1800,
          moves: 1,
          avgSpeedKmh: 12,
          typicalSpeedKmh: null,
          longest: null,
          fastest: null,
        },
      }),
    },
  });

  it("shows the mode's distance against the month before, and how it went", async () => {
    mockApi(trainRoutes());
    renderInsights("/insights/transport/train?period=2026-10");
    expect(await screen.findByRole("heading", { level: 1, name: "Train" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Insights" })).toHaveAttribute(
      "href",
      "/insights?period=2026-10",
    );
    const tiles = await hero();
    expect(within(tiles).getByText("60.0 km")).toBeVisible();
    expect(within(tiles).getByText("45 mins · 1 move · typically 96 km/h")).toBeVisible();
    // 60 km against the 50 km of September.
    expect(await within(tiles).findByText("20% more than September")).toBeVisible();
    expect(screen.getByRole("figure", { name: "Distance per day" })).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Train · Insights · Trail"));
  });

  it("says when there was none in the month before", async () => {
    mockApi(trainRoutes());
    renderInsights("/insights/transport/cycling?period=2026-10");
    expect(await screen.findByText("None in September")).toBeVisible();
  });

  it("names the empty period of a mode without moves", async () => {
    mockApi({
      ...trainRoutes(),
      "GET /api/v1/insights/modes/cycling": {
        status: 200,
        body: modeInsights({
          mode: "cycling",
          period: monthPeriod("2026-10"),
          totals: {
            distanceM: 0,
            durationS: 0,
            moves: 0,
            avgSpeedKmh: 0,
            typicalSpeedKmh: null,
            longest: null,
            fastest: null,
          },
        }),
      },
    });
    renderInsights("/insights/transport/cycling?period=2026-10");
    expect(await screen.findByRole("heading", { name: "No cycling in this period" })).toBeVisible();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("names no mode that does not exist, and asks for nothing", async () => {
    const { calls } = mockApi(standardRoutes());
    renderInsights("/insights/transport/teleport");
    expect(await screen.findByRole("heading", { name: "No such mode" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Back to Insights" })).toHaveLength(2);
    expect(calls.some((call) => call.path.startsWith("/api/v1/insights"))).toBe(false);
  });

  it("opens from the list and goes back to its row, with focus on the title and then on the row", async () => {
    const browser = userEvent.setup();
    mockApi(trainRoutes());
    const { router } = renderInsights("/insights?period=2026-10");
    const nav = await screen.findByRole("navigation", { name: "Insights" });
    await browser.click(await within(nav).findByRole("link", { name: "Train 60.0 km · 91%" }));
    const title = await screen.findByRole("heading", { level: 1, name: "Train" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(router.state.location.pathname).toBe("/insights/transport/train");

    await browser.click(screen.getByRole("link", { name: "Back to Insights" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/insights"));
    // Opened from the summary, Back is the browser's back: no entry is added.
    expect(router.state.historyAction).toBe("POP");
    const row = await screen.findByRole("link", { name: "Train 60.0 km · 91%" });
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("goes to the summary, with the period, when it was not opened from there", async () => {
    const browser = userEvent.setup();
    mockApi(trainRoutes());
    const { router } = renderInsights("/insights/transport/train?period=2026-10");
    await screen.findByRole("heading", { level: 1, name: "Train" });
    await browser.click(screen.getByRole("link", { name: "Back to Insights" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/insights"));
    expect(router.state.location.search).toBe("?period=2026-10");
    expect(router.state.historyAction).toBe("PUSH");
  });
});

describe("when you travel", () => {
  it("draws the hours of the week under the time on the move", async () => {
    const { calls } = mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/time": { status: 200, body: timeInsights() },
    });
    renderInsights("/insights/time?period=2026-10");
    expect(await screen.findByRole("heading", { level: 1, name: "When you travel" })).toBeVisible();
    const grid = await screen.findByRole("figure", {
      name: "Time on the move by weekday and hour",
    });
    expect(grid).toHaveAccessibleDescription(
      "Most often on Wednesday at 08:00 (45 mins); 1 hr 15 mins on the move in all.",
    );
    expect(within(grid).getByRole("img", { name: "Wednesday, 08:00–09:00" })).toBeInTheDocument();
    const tiles = await hero();
    expect(within(tiles).getByText("1 hr 15 mins")).toBeVisible();
    expect(within(tiles).getByText("Most often on Wednesday at 08:00")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Mode" })).toBeNull();
    expect(lastQuery(calls, "/api/v1/insights/time").get("from")).toBe("2026-10-01");
    expect(lastQuery(calls, "/api/v1/insights/time").has("mode")).toBe(false);
  });

  it("sends an address with a mode to the mode's own When, keeping the rest", async () => {
    const { calls } = mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/time": ({ url }) => ({
        status: 200,
        body: timeInsights({
          mode: url.searchParams.get("mode") === "cycling" ? "cycling" : null,
        }),
      }),
    });
    const { router } = renderInsights("/insights/time?mode=cycling&period=2026-10");
    expect(
      await screen.findByRole("figure", { name: "Time by cycling by weekday and hour" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/insights/transport/cycling/time");
    expect(router.state.location.search).toBe("?period=2026-10");
    // Replaced: Back does not return to the old address.
    expect(router.state.historyAction).toBe("REPLACE");
    expect(lastQuery(calls, "/api/v1/insights/time").get("mode")).toBe("cycling");
    expect(screen.getByRole("heading", { level: 1, name: "When" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Cycling" })).toHaveAttribute(
      "href",
      "/insights/transport/cycling?period=2026-10",
    );
  });

  it("leaves a mode that does not exist to the screen for every mode", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/time": { status: 200, body: timeInsights() },
    });
    const { router } = renderInsights("/insights/time?mode=hovercraft");
    expect(
      await screen.findByRole("figure", { name: "Time on the move by weekday and hour" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/insights/time");
  });
});

describe("roads", () => {
  it("names the kind of way with the most distance, and lists the kinds with their shares", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/roads": { status: 200, body: roadInsights() },
    });
    renderInsights("/insights/roads?period=2026-10");
    expect(await screen.findByRole("heading", { level: 1, name: "Roads" })).toBeVisible();
    const tiles = await hero();
    expect(within(tiles).getByText("On railways")).toBeVisible();
    expect(within(tiles).getByText("87%")).toBeVisible();
    expect(within(tiles).getByText("of 66.0 km with map data")).toBeVisible();
    const kinds = await screen.findByRole("figure", { name: "Distance by kind of way" });
    expect(within(kinds).getByRole("img", { name: "Railways" })).toHaveAccessibleDescription(
      "57.6 km · 87%",
    );
    expect(screen.queryByRole("figure", { name: "Distance by group of ways" })).toBeNull();
    expect(screen.queryByText(/Map data covers/)).toBeNull();
  });

  it("says how much of the distance the map data covers", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/roads": { status: 200, body: roadInsights({ mappedM: 33_000 }) },
    });
    renderInsights("/insights/roads?period=2026-10");
    expect(await screen.findByText(/^Map data covers 50% of this distance/)).toBeVisible();
  });

  it("says when the moves have no map data", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/roads": {
        status: 200,
        body: roadInsights({ mappedM: 0, kinds: [], families: [] }),
      },
    });
    renderInsights("/insights/roads?period=2026-10");
    expect(await screen.findByText("No map data for these moves")).toBeVisible();
  });
});

describe("a mode's rows and their screens", () => {
  const modeRoutes = (mode: "train" | "cycling" | "plane" | "boat", overrides = {}) => ({
    ...octoberRoutes(),
    [`GET /api/v1/insights/modes/${mode}`]: {
      status: 200,
      body: modeInsights({ mode, period: monthPeriod("2026-10"), ...overrides }),
    },
    "GET /api/v1/insights/time": ({ url }: { url: URL }) => ({
      status: 200,
      body: timeInsights({ mode: url.searchParams.get("mode") === mode ? mode : null }),
    }),
  });

  it("lists When, Roads, Speed and Longest moves with what each says", async () => {
    mockApi(modeRoutes("train"));
    renderInsights("/insights/transport/train?period=2026-10");
    await screen.findByRole("heading", { level: 1, name: "Train" });
    expect(
      await screen.findByRole("link", { name: "When Mostly Wednesdays · 08:00" }),
    ).toHaveAttribute("href", "/insights/transport/train/time?period=2026-10");
    expect(screen.getByRole("link", { name: "Roads 96% on railway track" })).toHaveAttribute(
      "href",
      "/insights/transport/train/roads?period=2026-10",
    );
    expect(screen.getByRole("link", { name: "Speed Typically 96 km/h" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Longest moves 60.0 km · Wed 21 Oct" })).toBeVisible();
  });

  it("has no Roads row for a mode that is not laid onto the map", async () => {
    mockApi(modeRoutes("plane", { rail: null, stationStops: null }));
    renderInsights("/insights/transport/plane?period=2026-10");
    await screen.findByRole("link", { name: /^Speed/ });
    expect(screen.queryByRole("link", { name: /^Roads/ })).toBeNull();
  });

  it("opens a row, with the title in focus, and goes back to it", async () => {
    const browser = userEvent.setup();
    mockApi(modeRoutes("train"));
    const { router } = renderInsights("/insights/transport/train?period=2026-10");
    await browser.click(await screen.findByRole("link", { name: /^Speed / }));
    const title = await screen.findByRole("heading", { level: 1, name: "Speed" });
    await waitFor(() => expect(title).toHaveFocus());
    await waitFor(() => expect(document.title).toBe("Speed · Train · Insights · Trail"));
    await browser.click(screen.getByRole("link", { name: "Back to Train" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/insights/transport/train"));
    expect(router.state.historyAction).toBe("POP");
    const row = await screen.findByRole("link", { name: /^Speed / });
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("shows a mode's hours of the week", async () => {
    const { calls } = mockApi(modeRoutes("cycling"));
    renderInsights("/insights/transport/cycling/time?period=2026-10");
    expect(
      await screen.findByRole("figure", { name: "Time by cycling by weekday and hour" }),
    ).toBeVisible();
    expect(lastQuery(calls, "/api/v1/insights/time").get("mode")).toBe("cycling");
    await waitFor(() => expect(document.title).toBe("When · Cycling · Insights · Trail"));
  });

  it("shows how much of a train's distance was on the rails, and its halts", async () => {
    mockApi(modeRoutes("train"));
    renderInsights("/insights/transport/train/roads?period=2026-10");
    const tiles = await hero();
    expect(within(tiles).getByText("On railway track")).toBeVisible();
    expect(within(tiles).getByText("96%")).toBeVisible();
    expect(within(tiles).getByText("3 halts at stations, 3 a ride")).toBeVisible();
    expect(await screen.findByRole("figure", { name: "Distance by kind of way" })).toBeVisible();
  });

  it("shows the kind of road a bike took, and says when there is no map data", async () => {
    const roads = {
      distanceM: 6000,
      mappedM: 6000,
      kinds: [
        { kind: "residential" as const, distanceM: 2280, share: 0.38 },
        { kind: "cycleway" as const, distanceM: 3720, share: 0.62 },
      ],
    };
    mockApi(modeRoutes("cycling", { rail: null, stationStops: null, roads }));
    const view = renderInsights("/insights/transport/cycling/roads?period=2026-10");
    const tiles = await hero();
    expect(within(tiles).getByText("On cycleways")).toBeVisible();
    expect(within(tiles).getByText("62%")).toBeVisible();
    expect(await screen.findByRole("figure", { name: "Distance by kind of road" })).toBeVisible();
    view.unmount();

    mockApi(
      modeRoutes("cycling", {
        rail: null,
        stationStops: null,
        roads: { distanceM: 6000, mappedM: 0, kinds: [] },
      }),
    );
    renderInsights("/insights/transport/cycling/roads?period=2026-10");
    expect(await screen.findByText("No map data for these moves")).toBeVisible();
  });

  it("states a boat's share on ferry routes, and a plane has no roads", async () => {
    mockApi(modeRoutes("boat", { rail: null, ferry: { distanceM: 800, share: 0.8 } }));
    const view = renderInsights("/insights/transport/boat/roads?period=2026-10");
    expect(within(await hero()).getByText("80%")).toBeVisible();
    expect(screen.getByText("On ferry routes")).toBeVisible();
    view.unmount();
    mockApi(modeRoutes("plane", { rail: null, stationStops: null }));
    renderInsights("/insights/transport/plane/roads?period=2026-10");
    expect(await screen.findByRole("heading", { name: "No roads for plane" })).toBeVisible();
  });

  it("shows the typical speed, the moves by speed and the fastest move in History", async () => {
    mockApi(modeRoutes("train"));
    renderInsights("/insights/transport/train/speed?period=2026-10");
    const tiles = await hero();
    expect(within(tiles).getByText("Typical speed")).toBeVisible();
    expect(within(tiles).getByText("96 km/h")).toBeVisible();
    expect(within(tiles).getByText("Average 80 km/h")).toBeVisible();
    expect(await screen.findByRole("figure", { name: "Moves by speed" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Fastest move 141 km/h top · Wed 21 Oct" }),
    ).toHaveAttribute("href", `/?view=history&date=2026-10-21&person=me&segment=${segmentId}`);
  });

  it("lists the longest moves, each opening its day in History", async () => {
    mockApi(modeRoutes("train"));
    renderInsights("/insights/transport/train/moves?period=2026-10");
    const tiles = await hero();
    expect(within(tiles).getByText("Longest move")).toBeVisible();
    expect(within(tiles).getByText("60.0 km")).toBeVisible();
    expect(within(tiles).getByText("Wed 21 Oct")).toBeVisible();
    const link = await screen.findByRole("link", {
      name: /^Wed 21 Oct, 08:42 60\.0 km · 45 mins · 80 km\/h average$/,
    });
    expect(link).toHaveAttribute(
      "href",
      `/?view=history&date=2026-10-21&person=me&segment=${segmentId}`,
    );
  });

  it("names no mode that does not exist on a part of a mode either", async () => {
    const { calls } = mockApi(standardRoutes());
    renderInsights("/insights/transport/teleport/speed");
    expect(await screen.findByRole("heading", { name: "No such mode" })).toBeVisible();
    expect(calls.some((call) => call.path.startsWith("/api/v1/insights"))).toBe(false);
  });
});

describe("places", () => {
  const placeRoutes = () => ({
    ...octoberRoutes(),
    "GET /api/v1/insights/places": { status: 200, body: placesAnswer() },
    "GET /api/v1/insights/place": ({ url }: { url: URL }) => {
      const street = url.searchParams.get("place") === placeKeys.street;
      const answer = placeAnswer();
      const [first] = placesAnswer().places.filter((entry) => entry.key === placeKeys.street);
      return {
        status: 200,
        body:
          street && first !== undefined && answer.place !== null
            ? { ...answer, place: { ...answer.place, ...first, cells: 1 } }
            : answer,
      };
    },
  });

  it("counts the places, charts the top ones and lists them with what each is called", async () => {
    mockApi(placeRoutes());
    renderInsights("/insights/places?period=2026-10");
    expect(await screen.findByRole("heading", { level: 1, name: "Places" })).toBeVisible();
    const tiles = await hero();
    expect(within(tiles).getByText("16")).toBeVisible();
    expect(within(tiles).getByText("28 visits · 100 hrs")).toBeVisible();
    expect(await screen.findByRole("figure", { name: "Time at your top places" })).toBeVisible();

    const station = await screen.findByRole("link", {
      name: /^Gent-Sint-Pieters 12 hrs · 9 visits$/,
    });
    expect(station).toHaveAttribute(
      "href",
      `/insights/place?period=2026-10&place=${placeKeys.station}`,
    );
    // Within 30 m the place is the stop; within 150 m it is near it; else the road.
    expect(screen.getByRole("link", { name: /^Near Korenmarkt 10 hrs · 7 visits$/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /^Kerkstraat 2 hrs · 3 visits$/ })).toBeVisible();
    // Without a name, the coordinates tell it from the others.
    expect(
      screen.getByRole("link", {
        name: /^Unnamed place 51\.0362° N, 3\.7104° E 1 hr · 6 visits$/,
      }),
    ).toBeVisible();
    expect(screen.getByText("and 12 more places, 4 hrs")).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Places · Insights · Trail"));
  });

  it("says when there were no stops", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/places": {
        status: 200,
        body: placesAnswer({
          totals: { places: 0, durationS: 0, visits: 0 },
          places: [],
          rest: { places: 0, durationS: 0, visits: 0 },
        }),
      },
    });
    renderInsights("/insights/places?period=2026-10");
    expect(await screen.findByRole("heading", { name: "No stops in October 2026" })).toBeVisible();
  });

  it("is a row of the list, current on its screens", async () => {
    mockApi(placeRoutes());
    renderInsights(`/insights/place?period=2026-10&place=${placeKeys.station}`, { wide: true });
    const nav = await screen.findByRole("navigation", { name: "Insights" });
    expect(await within(nav).findByRole("link", { name: "Places" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Places" })).toHaveAttribute(
      "href",
      "/insights/places?period=2026-10",
    );
  });

  it("shows one place: the time there, how it went, the first and last time, the latest days", async () => {
    const { calls } = mockApi(placeRoutes());
    renderInsights(`/insights/place?period=2026-10&place=${placeKeys.station}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Gent-Sint-Pieters" }),
    ).toBeVisible();
    const tiles = await hero();
    expect(within(tiles).getByText("Time here")).toBeVisible();
    expect(within(tiles).getByText("12 hrs")).toBeVisible();
    expect(within(tiles).getByText("9 visits on 9 days")).toBeVisible();
    expect(await screen.findByRole("figure", { name: "Time here per day" })).toBeVisible();
    expect(screen.getByText("First here")).toBeVisible();
    expect(screen.getByText("Last here")).toBeVisible();

    const days = screen.getByRole("list", { name: "Days" });
    const rows = within(days).getAllByRole("link");
    // The seven latest, then the way to all of them.
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveAttribute("href", "/?view=history&date=2026-10-28&person=me");
    expect(rows[0]).toHaveTextContent("Wed 28 Oct");
    expect(rows[0]).toHaveTextContent("9 hrs 12 mins · 2 visits");
    expect(within(days).getByRole("link", { name: "All 9 days" })).toHaveAttribute(
      "href",
      `/insights/place/days?period=2026-10&place=${placeKeys.station}`,
    );
    expect(lastQuery(calls, "/api/v1/insights/place").get("place")).toBe(placeKeys.station);
    await waitFor(() =>
      expect(document.title).toBe("Gent-Sint-Pieters · Places · Insights · Trail"),
    );
    expect(screen.getByRole("link", { name: "Back to Places" })).toHaveAttribute(
      "href",
      "/insights/places?period=2026-10",
    );
  });

  it("names a place without a name by where it is, and says when there is no visit", async () => {
    mockApi({
      ...octoberRoutes(),
      "GET /api/v1/insights/place": {
        status: 200,
        body: placeAnswer({ place: null, days: [], series: [] }),
      },
    });
    renderInsights(`/insights/place?period=2026-10&place=${placeKeys.unnamed}`);
    expect(
      await screen.findByRole("heading", { name: "No visits here in October 2026" }),
    ).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Back to Places/ }).length).toBeGreaterThan(0);
  });

  it("asks for nothing when the address names no place", async () => {
    const { calls } = mockApi(placeRoutes());
    renderInsights("/insights/place?period=2026-10&place=../../etc");
    expect(await screen.findByRole("heading", { name: "No such place" })).toBeVisible();
    expect(calls.some((call) => call.path.startsWith("/api/v1/insights/place"))).toBe(false);
  });

  it("lists all the days at a place, newest first, each opening its day in History", async () => {
    mockApi(placeRoutes());
    renderInsights(`/insights/place/days?period=2026-10&place=${placeKeys.station}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Days" })).toBeVisible();
    const tiles = await hero();
    expect(within(tiles).getByText("9 days")).toBeVisible();
    const rows = await screen.findAllByRole("link", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) / });
    expect(rows).toHaveLength(9);
    expect(rows.at(-1)).toHaveAttribute("href", "/?view=history&date=2026-10-02&person=me");
    expect(screen.getByRole("link", { name: "Back to Gent-Sint-Pieters" })).toHaveAttribute(
      "href",
      `/insights/place?period=2026-10&place=${placeKeys.station}`,
    );
    await waitFor(() =>
      expect(document.title).toBe("Days · Gent-Sint-Pieters · Places · Insights · Trail"),
    );
  });

  it("goes back to the row of the place among the others, with focus there", async () => {
    const browser = userEvent.setup();
    mockApi(placeRoutes());
    const { router } = renderInsights("/insights/places?period=2026-10");
    await browser.click(await screen.findByRole("link", { name: /^Kerkstraat / }));
    const title = await screen.findByRole("heading", { level: 1, name: "Kerkstraat" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(router.state.location.pathname).toBe("/insights/place");

    await browser.click(screen.getByRole("link", { name: "Back to Places" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/insights/places"));
    expect(router.state.historyAction).toBe("POP");
    const row = await screen.findByRole("link", { name: /^Kerkstraat / });
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.getByRole("link", { name: /^Gent-Sint-Pieters / })).not.toHaveFocus();
  });
});

describe("the summary on a warm open", () => {
  it("shows the copy of the period at once, then the server's newer numbers", async () => {
    const params = { from: null, to: today(), deviceIds: null, mode: null };
    const queryClient = createTestQueryClient();
    await warmClient(queryClient, user, (store) =>
      seedEntry(store, {
        user,
        queryKey: queryKeys.insightsOverview(params),
        answer: octoberOverview(),
        fetchedAt: Date.now() - 3_600_000,
        etag: 'W/"overview-1"',
      }),
    );
    const newer = octoberOverview({ totals: { ...octoberOverview().totals, distanceM: 77_000 } });
    const server = holdAll({
      ...standardRoutes(),
      "GET /api/v1/insights/overview": { status: 200, body: newer, etag: 'W/"overview-2"' },
    });
    const api = mockApi(server.routes);
    renderInsights("/insights?period=all", { queryClient });
    // Not warm: the persister restores it on mount, still before the server answered.
    const tiles = await hero();
    expect(within(tiles).getByText("66.0 km")).toBeVisible();
    expect(api.calls.every((call) => call.status === undefined)).toBe(true);
    server.release();
    expect(await within(tiles).findByText("77.0 km")).toBeVisible();
    const revalidation = api.calls.find((call) => call.path === "/api/v1/insights/overview");
    expect(revalidation?.headers?.["if-none-match"]).toBe('W/"overview-1"');
    expect(revalidation?.status).toBe(200);
  });
});
