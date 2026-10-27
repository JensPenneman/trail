import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import type { Preferences } from "@trail/contracts/preferences";
import type { SessionUser } from "@trail/contracts/user";
import { Outlet } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actorSegment } from "../src/accessLog/actorAddress";
import { RequireSession } from "../src/app/RequireSession";
import { useRouteFocus } from "../src/app/useRouteFocus";
import { WhoViewedYouCard } from "../src/pages/insights/WhoViewedYouCard";
import { settingsRoute } from "../src/settings/settingsRoutes";
import { accessLine, busySummary, emptySummary, page } from "./support/accessLogFixtures";
import { ids, outgoingShare, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { renderSettings } from "./support/renderSettings";
import { standardRoutes } from "./support/standardRoutes";

const heading = (name: string) => screen.findByRole("heading", { level: 1, name });

// Midday in Brussels: lines of the last hours, and "today", stay on today whenever the suite runs.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T11:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

type Calls = ReturnType<typeof mockApi>["calls"];

/** The queries of the requests to `path`, in order. */
const queriesOf = (calls: Calls, path: string): URLSearchParams[] =>
  calls
    .filter((call) => call.path === path)
    .map((call) => new URL(call.url ?? "http://localhost/").searchParams);

const summaryRoute =
  (summary: (days: number) => DataAccessSummary) =>
  ({ url }: { url: URL }) => ({
    status: 200,
    body: summary(Number(url.searchParams.get("days") ?? "30")),
  });

const withPreferences = (preferences: Partial<Preferences>): SessionUser => ({
  ...user,
  preferences: { ...user.preferences, ...preferences },
});

function Frame() {
  useRouteFocus();
  return (
    <main>
      <Outlet />
    </main>
  );
}

/** Settings behind the real route guard, so the session (and its preferences) is the query's. */
function renderSignedInSettings(url: string, account: SessionUser, routes: object = {}) {
  let current = account;
  const api = mockApi({
    ...standardRoutes(),
    "GET /api/auth/session": () => ({ status: 200, body: { user: current } }),
    "PATCH /api/me": ({ body }) => {
      const { preferences } = body as { preferences: Partial<Preferences> };
      current = { ...current, preferences: { ...current.preferences, ...preferences } };
      return { status: 200, body: { user: current } };
    },
    ...routes,
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = renderPage(null, {
    url,
    routes: [
      {
        element: <RequireSession />,
        children: [{ element: <Frame />, children: [settingsRoute] }],
      },
    ],
  });
  return { ...api, ...view };
}

describe("Settings › Who viewed you", () => {
  it("shows who looked in the period, how often, per day, and a page for each", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/access-log/summary": summaryRoute((days) => busySummary(days)),
    });
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/privacy/viewers");
    expect(await heading("Who viewed you")).toBeInTheDocument();
    const tiles = await screen.findByRole("group", { name: "Totals of the last 30 days" });
    const tile = (name: string) => within(tiles).getByText(name).closest(".stat-tile");
    expect(tile("People")).toHaveTextContent("1");
    expect(tile("People")).toHaveTextContent("16 looks · 30 live updates");
    expect(tile("Link visitors")).toHaveTextContent("23 views");
    expect(tile("API calls")).toHaveTextContent("10by 1 token");
    expect(tile("MCP calls")).toHaveTextContent("4by 1 token");
    // Your own activity is left out unless you choose otherwise.
    expect(within(tiles).queryByText("Your own activity")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your browsers" })).not.toBeInTheDocument();

    const chart = screen.getByRole("figure", { name: "Accesses per day, by who" });
    expect(within(chart).getAllByRole("img")).toHaveLength(30);
    expect(within(chart).getByRole("list", { name: "Legend" })).toHaveTextContent(
      /People.*Link visitors.*API tokens/,
    );
    expect(within(chart).getByRole("list", { name: "Legend" })).not.toHaveTextContent("You");

    const people = screen.getByRole("list", { name: "People" });
    const ana = within(people).getByRole("link", { name: "Ana Bell" });
    expect(ana).toHaveAccessibleDescription(
      /^Ana Bell looked at your live position 14 times and your history twice, and received 30 live updates, last today at \d{2}:\d{2}\.$/,
    );
    expect(ana).toHaveAttribute(
      "href",
      `/settings/privacy/viewers/${actorSegment(`person:${ids.ana}`)}`,
    );
    expect(
      within(screen.getByRole("list", { name: "Public links" })).getByRole("link", {
        name: "Jens on the way home",
      }),
    ).toHaveAccessibleDescription(/^Opened 3 times by 2 visitors, last /);
    expect(
      within(screen.getByRole("list", { name: "API tokens" })).getByRole("link", {
        name: "Home Assistant",
      }),
    ).toHaveAccessibleDescription(/^Used 14 times: 10 API calls and 4 through MCP, last /);

    // Another period is another request, and an address of its own.
    await person.click(screen.getByRole("radio", { name: "7 days" }));
    await waitFor(() =>
      expect(queriesOf(calls, "/api/v1/access-log/summary").at(-1)?.get("days")).toBe("7"),
    );
    expect(router.state.location.search).toBe("?days=7");
    expect(await screen.findByRole("group", { name: "Totals of the last 7 days" })).toBeVisible();
    expect(within(screen.getByRole("list", { name: "People" })).getByRole("link")).toHaveAttribute(
      "href",
      `/settings/privacy/viewers/${actorSegment(`person:${ids.ana}`)}?days=7`,
    );
  });

  it("counts your own activity too once you switch it on, and saves that", async () => {
    const person = userEvent.setup();
    const { calls } = renderSignedInSettings("/settings/privacy/viewers", user, {
      "GET /api/v1/access-log/summary": summaryRoute((days) => busySummary(days)),
    });
    expect(await heading("Who viewed you")).toBeInTheDocument();
    await screen.findByRole("group", { name: "Totals of the last 30 days" });
    const own = screen.getByRole("switch", { name: "Your own activity" });
    expect(own).not.toBeChecked();
    await person.click(own);
    expect(own).toBeChecked();
    await waitFor(() =>
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
        preferences: { showOwnActivity: true },
      }),
    );
    expect(await screen.findByText("Your own activity is shown too.")).toBeInTheDocument();
    const tiles = screen.getByRole("group", { name: "Totals of the last 30 days" });
    expect(within(tiles).getByText("Your own activity").closest(".stat-tile")).toHaveTextContent(
      "120in 1 browser",
    );
    expect(
      within(screen.getByRole("list", { name: "Your browsers" })).getByRole("link", {
        name: "Firefox on Mac",
      }),
    ).toHaveAttribute(
      "href",
      `/settings/privacy/viewers/${actorSegment("session:Firefox on Mac")}`,
    );
    expect(
      within(screen.getByRole("figure", { name: "Accesses per day, by who" })).getByRole("list", {
        name: "Legend",
      }),
    ).toHaveTextContent(/API tokens.*You/);
  });

  it("says so when nobody looked", async () => {
    mockApi(standardRoutes());
    renderSettings("/settings/privacy/viewers", {
      user: withPreferences({ showOwnActivity: true }),
    });
    expect(
      await screen.findByRole("heading", { level: 2, name: "Nobody looked in the last 30 days" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/and so does what you do yourself/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Your own activity" })).toBeChecked();
    expect(document.title).toBe("Who viewed you · Settings · Trail");
  });

  it("says why it failed, and tries again", async () => {
    let fail = true;
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/access-log/summary": () =>
        fail
          ? { status: 503, body: { error: { code: "unavailable", message: "Down for a moment." } } }
          : { status: 200, body: busySummary(30) },
    });
    const person = userEvent.setup();
    renderSettings("/settings/privacy/viewers");
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Who viewed you could not be loaded");
    fail = false;
    await person.click(within(error).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "People" })).toBeInTheDocument();
  });
});

describe("Settings › Who viewed you › one of them", () => {
  it("shows a person's looks per day and hour by hour, each line opening to what it read", async () => {
    const actorId = `person:${ids.ana}`;
    const folded = accessLine(
      { count: 37, resource: { deviceIds: [ids.phone], folded: true } },
      2 * 3_600_000,
    );
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/access-log/summary": summaryRoute((days) => busySummary(days)),
      "GET /api/v1/access-log": { status: 200, body: page([accessLine(), folded]) },
    });
    const person = userEvent.setup();
    renderSettings(`/settings/privacy/viewers/${actorSegment(actorId)}`);
    expect(await heading("Ana Bell")).toBeInTheDocument();
    expect(document.title).toBe("Ana Bell · Who viewed you · Settings · Trail");
    expect(screen.getByText("Someone you share with")).toBeInTheDocument();
    expect(
      await screen.findByText(/^Ana Bell looked at your live position 14 times/),
    ).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Looks per day" })).toBeInTheDocument();
    expect(queriesOf(calls, "/api/v1/access-log/summary").at(-1)?.get("actorId")).toBe(actorId);
    const lines = queriesOf(calls, "/api/v1/access-log").at(-1);
    expect(lines?.get("actorId")).toBe(actorId);
    expect(lines?.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);

    const hourByHour = screen.getByRole("region", { name: "Hour by hour" });
    const today = within(hourByHour).getByRole("list", { name: "Today" });
    const [first, second] = within(today).getAllByRole("listitem");
    expect(first).toHaveTextContent(/^Your history/);
    expect(first).toHaveTextContent("twice");
    expect(second).toHaveTextContent("… and 37 more");
    // Opened, a line says everything: which devices, the period, how precisely, the answer.
    const line = within(first as HTMLElement);
    expect(line.getByText("200 OK")).not.toBeVisible();
    await person.click(line.getByText("Your history"));
    expect(line.getByText("200 OK")).toBeVisible();
    expect(first).toHaveTextContent("DeviceiPhone 16");
    expect(first).toHaveTextContent("PrecisionPrecise location");
    expect(first).toHaveTextContent("Answer200 OK");
    expect(screen.getByRole("link", { name: "Your share with Ana Bell" })).toHaveAttribute(
      "href",
      `/settings/sharing/${ids.myShare}`,
    );
    expect(within(hourByHour).getByText("That is all for this period.")).toBeInTheDocument();
  });

  it("names a token by its name even when it did nothing in the period", async () => {
    mockApi(standardRoutes());
    renderSettings(`/settings/privacy/viewers/${actorSegment(`token:${ids.token}`)}`);
    expect(await heading("Home Assistant")).toBeInTheDocument();
    expect(await screen.findByText("Nothing in the last 30 days.")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 3, name: "Nothing in the last 30 days" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The token's page" })).toHaveAttribute(
      "href",
      `/settings/tokens/${ids.token}`,
    );
  });

  it("has a page that says so for an address that names no one", async () => {
    mockApi(standardRoutes());
    renderSettings("/settings/privacy/viewers/not-an-actor");
    expect(await heading("Viewer not found")).toBeInTheDocument();
  });
});

describe("Settings › Access log", () => {
  it("lists everyone's accesses but yours, newest first, and loads more", async () => {
    const older = accessLine(
      {
        actorKind: "link",
        channel: "link",
        action: "link.view",
        actor: {
          kind: "link",
          linkId: ids.link,
          linkLabel: "Jens on the way home",
          visitor: {
            key: "7d1c0a9e4b2f8c31",
            ipCoarse: "81.82.83.0/24",
            uaFamily: "iPhone · Safari",
          },
        },
        count: 1,
        resource: { precision: "approximate" },
      },
      30 * 3_600_000,
    );
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/access-log": ({ url }) => ({
        status: 200,
        body:
          url.searchParams.get("cursor") === null
            ? page([accessLine()], "cursor-1")
            : page([older]),
      }),
    });
    const person = userEvent.setup();
    renderSettings("/settings/privacy/access-log");
    expect(await heading("Access log")).toBeInTheDocument();
    const today = await screen.findByRole("list", { name: "Today" });
    expect(within(today).getByRole("listitem")).toHaveTextContent(
      /^Ana BellYour history · twice · /,
    );
    const first = queriesOf(calls, "/api/v1/access-log")[0];
    expect(first?.get("actor")).toBe("person,link,token");
    expect(first?.get("limit")).toBe("50");
    expect(first?.get("cursor")).toBeNull();

    await person.click(screen.getByRole("button", { name: "Load more" }));
    const end = await screen.findByText("That is all: lines are kept for a year.");
    // The button is gone with the last page: its focus goes to the line that says so.
    await waitFor(() => expect(end).toHaveFocus());
    expect(await screen.findByText("1 more line. That is all.")).toBeInTheDocument();
    expect(queriesOf(calls, "/api/v1/access-log").at(-1)?.get("cursor")).toBe("cursor-1");
    // The first page stays, the next one comes under it.
    expect(screen.getByRole("list", { name: "Today" })).toBeInTheDocument();
    // Opened, a line leads to everything its actor did.
    await person.click(within(today).getByText("Ana Bell"));
    expect(within(today).getByRole("link", { name: "Everything by Ana Bell" })).toHaveAttribute(
      "href",
      `/settings/privacy/viewers/${actorSegment(`person:${ids.ana}`)}`,
    );
    const visitor = screen.getByText("Jens on the way home").closest("li");
    expect(visitor).toHaveTextContent("The link's page · iPhone · Safari, 81.82.83.0/24 · once · ");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("filters by who, channel, period and action, in its address", async () => {
    const { calls } = mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/privacy/access-log");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Nothing recorded yet" }),
    ).toBeInTheDocument();
    const filters = screen.getByRole("group", { name: "Filters" });
    // Without your own activity there is no "You" to choose, nor your browser.
    expect(
      within(within(filters).getByRole("combobox", { name: "Who" })).queryByRole("option", {
        name: "You",
      }),
    ).not.toBeInTheDocument();
    await person.selectOptions(within(filters).getByRole("combobox", { name: "Who" }), "link");
    await person.selectOptions(within(filters).getByRole("combobox", { name: "Through" }), "link");
    await person.selectOptions(within(filters).getByRole("combobox", { name: "Period" }), "7");
    await person.selectOptions(
      within(filters).getByRole("combobox", { name: "Action" }),
      "link.view",
    );
    await waitFor(() => {
      const last = queriesOf(calls, "/api/v1/access-log").at(-1);
      expect(last?.get("actor")).toBe("link");
      expect(last?.get("channel")).toBe("link");
      expect(last?.get("action")).toBe("link.view");
      expect(last?.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
    });
    expect(new URLSearchParams(router.state.location.search).toString()).toBe(
      "actor=link&channel=link&days=7&action=link.view",
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "No lines match these filters" }),
    ).toBeInTheDocument();
    await person.click(screen.getAllByRole("button", { name: "Clear filters" })[0] as HTMLElement);
    expect(router.state.location.search).toBe("");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Nothing recorded yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^API guide: Access log/ })).toHaveAttribute(
      "href",
      "https://github.com/JensPenneman/trail/blob/main/docs/api.md#access-log",
    );
  });

  it("lists your own activity too with the switch on the page", async () => {
    const person = userEvent.setup();
    const { calls } = renderSignedInSettings("/settings/privacy/access-log", user);
    expect(await heading("Access log")).toBeInTheDocument();
    await screen.findByRole("heading", { level: 2, name: "Nothing recorded yet" });
    await person.click(screen.getByRole("switch", { name: "Your own activity" }));
    await waitFor(() =>
      expect(queriesOf(calls, "/api/v1/access-log").at(-1)?.get("actor")).toBeNull(),
    );
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      preferences: { showOwnActivity: true },
    });
    expect(
      within(screen.getByRole("combobox", { name: "Who" })).getByRole("option", { name: "You" }),
    ).toBeInTheDocument();
  });

  it("says why it failed, and tries again", async () => {
    let fail = true;
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/access-log": () =>
        fail
          ? { status: 500, body: { error: { code: "internal", message: "Something broke." } } }
          : { status: 200, body: page([accessLine()]) },
    });
    const person = userEvent.setup();
    renderSettings("/settings/privacy/access-log");
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("The access log could not be loaded");
    fail = false;
    await person.click(within(error).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Today" })).toBeInTheDocument();
  });
});

describe("the usage of a token, a link and a share", () => {
  const routes = () => ({
    ...standardRoutes(),
    "GET /api/v1/access-log/summary": summaryRoute((days) => busySummary(days)),
    "GET /api/v1/access-log": {
      status: 200,
      body: page([
        accessLine({
          actorKind: "token",
          channel: "mcp",
          action: "mcp.get_timeline",
          actor: { kind: "token", tokenId: ids.token, tokenName: "Home Assistant" },
          count: 4,
          resource: { date: "2026-10-26" },
        }),
      ]),
    },
  });

  it("is on the token's page: calls per day, API and MCP apart, and its last actions", async () => {
    const { calls } = mockApi(routes());
    renderSettings(`/settings/tokens/${ids.token}`);
    expect(await heading("Home Assistant")).toBeInTheDocument();
    expect(
      await screen.findByText(/^Used 14 times: 10 API calls and 4 through MCP, last /),
    ).toBeInTheDocument();
    const chart = screen.getByRole("figure", { name: "Calls per day" });
    expect(within(chart).getByRole("list", { name: "Legend" })).toHaveTextContent(/API.*MCP/);
    expect(within(chart).getByRole("table", { name: "Calls per day" })).toBeInTheDocument();
    const last = await screen.findByRole("list", { name: "Last actions" });
    expect(within(last).getByText("Timeline")).toBeInTheDocument();
    expect(last).toHaveTextContent("MCP server · 4 times · last ");
    expect(
      within(last).getByRole("link", { name: "Everything it did, hour by hour" }),
    ).toHaveAttribute("href", `/settings/privacy/viewers/${actorSegment(`token:${ids.token}`)}`);
    const summary = queriesOf(calls, "/api/v1/access-log/summary").find(
      (query) => query.get("actorId") === `token:${ids.token}`,
    );
    expect(summary?.get("days")).toBe("30");
  });

  it("is on the link's page: views per day and distinct visitors", async () => {
    mockApi(routes());
    renderSettings(`/settings/links/${ids.link}`);
    expect(await heading("Jens on the way home")).toBeInTheDocument();
    const tiles = await screen.findByRole("group", { name: "Views" });
    expect(within(tiles).getByText("Visitors").closest(".stat-tile")).toHaveTextContent("2");
    expect(screen.getByRole("figure", { name: "Views per day" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Its visitors, hour by hour" })).toHaveAttribute(
      "href",
      `/settings/privacy/viewers/${actorSegment(`link:${ids.link}`)}`,
    );
  });

  it("is on the share's page: what that person looked at, and when last", async () => {
    mockApi(routes());
    renderSettings(`/settings/sharing/${ids.myShare}`);
    expect(await heading("Ana Bell")).toBeInTheDocument();
    expect(
      await screen.findByText(
        /^Ana Bell looked at your live position 14 times and your history twice/,
      ),
    ).toBeInTheDocument();
    const chart = screen.getByRole("figure", { name: "Looks by what they saw" });
    const table = within(chart).getByRole("table", { name: "Looks by what they saw" });
    expect(
      within(table).getByRole("rowheader", { name: "Your new positions, live" }),
    ).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Your history" })).toBeInTheDocument();
  });

  it("does not keep a stopped share's page waiting for the access log", async () => {
    let stopped = false;
    const { fetchMock } = mockApi({
      ...routes(),
      "GET /api/v1/shares": () => ({
        status: 200,
        body: { shares: stopped ? [] : [outgoingShare()] },
      }),
      [`DELETE /api/v1/shares/${ids.myShare}`]: () => {
        stopped = true;
        return { status: 204 };
      },
    });
    // Once the share has stopped, the log answers late: the page leaves all the same.
    const held: (() => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const { pathname } = new URL(String(input), "http://localhost");
        if (stopped && pathname.startsWith("/api/v1/access-log")) {
          return new Promise<Response>((resolve) => {
            held.push(() => resolve(fetchMock(input, init)));
          });
        }
        return fetchMock(input, init);
      }),
    );
    const person = userEvent.setup();
    renderSettings(`/settings/sharing/${ids.myShare}`);
    expect(await heading("Ana Bell")).toBeInTheDocument();
    await screen.findByRole("figure", { name: "Looks by what they saw" });
    await person.click(screen.getByRole("button", { name: "Stop sharing" }));
    const stop = await screen.findByRole("dialog", { name: "Stop sharing with Ana Bell?" });
    await person.click(within(stop).getByRole("button", { name: "Stop sharing" }));
    expect(await heading("Sharing")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Share not found" })).not.toBeInTheDocument();
    for (const release of held) release();
  });

  it("says when there is none", async () => {
    mockApi(standardRoutes());
    renderSettings(`/settings/tokens/${ids.token}`);
    expect(await screen.findByText("Not used in the last 30 days.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Last actions" })).not.toBeInTheDocument();
  });
});

describe("Insights' card of who viewed you", () => {
  it("shows who looked this month, and who most, with the way to the whole page", async () => {
    mockApi({ ...standardRoutes(), "GET /api/v1/access-log/summary": summaryRoute(busySummary) });
    renderPage(<WhoViewedYouCard />, { path: "/insights", user });
    const card = await screen.findByRole("region", { name: "Who viewed you" });
    expect(within(card).getByText("People").closest(".stat-tile")).toHaveTextContent("116 looks");
    expect(within(card).getByText("Ana Bell looked most often: 46 times.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "See who viewed you" })).toHaveAttribute(
      "href",
      "/settings/privacy/viewers",
    );
  });

  it("is not there while nobody but you looked", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      "GET /api/v1/access-log/summary": () => ({
        status: 200,
        body: { ...emptySummary(30), own: busySummary(30).own },
      }),
    });
    renderPage(<WhoViewedYouCard />, { path: "/insights", user });
    await waitFor(() => expect(queriesOf(calls, "/api/v1/access-log/summary")).toHaveLength(1));
    expect(screen.queryByRole("region", { name: "Who viewed you" })).not.toBeInTheDocument();
  });
});
