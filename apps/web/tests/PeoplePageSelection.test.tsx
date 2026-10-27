import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ana, bob, ids, tracks, user } from "./support/fixtures";
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
const people = () => screen.getByRole("group", { name: "People" });
const views = () =>
  within(screen.getByRole("group", { name: "Map view" }))
    .getAllByRole("radio")
    .map((radio) => radio.closest("label")?.textContent);
const meCard = () => screen.getByRole("region", { name: "Me" });
const card = (name: string) => screen.getByRole("article", { name });
/** Ana shares precisely with seven days of history; bob approximately, live only. */
const anaWithHistory = () => ana({ share: { ...ana().share, historyDays: 7 } });
const trackOfAna = ({ url }: { url: URL }) => {
  const answer = tracks(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "");
  return {
    status: 200,
    body: {
      ...answer,
      tracks: answer.tracks.map((track) => ({ ...track, deviceId: ids.anaPhone })),
    },
  };
};
const withHistoryOfAna = () => ({
  ...standardRoutes(),
  "GET /api/v1/people": { status: 200, body: { people: [anaWithHistory(), bob()] } },
  [`GET /api/v1/people/${ids.ana}/track`]: trackOfAna,
});

describe("people on the map", () => {
  it("are offered beside Me, and the map shows only the signed-in person at first", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    expect(
      within(await screen.findByRole("group", { name: "People" })).getByRole("checkbox", {
        name: "Me",
      }),
    ).toBeChecked();
    expect(within(people()).getByRole("checkbox", { name: "Ana Bell" })).not.toBeChecked();
    expect(within(people()).getByRole("checkbox", { name: "bob" })).not.toBeChecked();
    expect(within(people()).getByRole("checkbox", { name: "Everyone" })).not.toBeChecked();
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "2"));
    // Everyone has a card; only Me is on the map.
    expect(within(meCard()).getByText("On the map")).toBeInTheDocument();
    expect(
      within(await screen.findByRole("article", { name: "Ana Bell" })).queryByText("On the map"),
    ).toBeNull();
    expect(views()).toEqual(["Live", "History", "Heat"]);
  });

  it("adds someone with the selector: their marker beside one's own, their card marked", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    await person.click(
      within(await screen.findByRole("group", { name: "People" })).getByRole("checkbox", {
        name: "Ana Bell",
      }),
    );
    expect(router.state.location.search).toBe(`?people=me%2C${ids.ana}`);
    expect(within(card("Ana Bell")).getByText("On the map")).toBeInTheDocument();
    expect(within(card("bob")).queryByText("On the map")).toBeNull();
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "3"));
    expect(screen.getByRole("article", { name: "iPhone 16" })).toBeInTheDocument();
    // Live only: there is no track of Ana to ask for.
    expect(api.calls.some((call) => call.path.endsWith("/track"))).toBe(false);
    // The device filter now lists her shared device under her name.
    const devices = screen.getByRole("group", { name: "Devices" });
    expect(within(devices).getByRole("group", { name: "Ana Bell" })).toBeInTheDocument();
    expect(within(devices).getByRole("checkbox", { name: "Ana’s iPhone" })).toBeChecked();
    // With Me still chosen, one's own views stay.
    expect(views()).toEqual(["Live", "History", "Heat"]);
    expect(screen.getByRole("group", { name: "Detail of the tracks" })).toBeInTheDocument();
  });

  it("shows only the person a deep link names", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: `/?view=live&people=${ids.ana}`, user });
    expect(
      within(await screen.findByRole("article", { name: "Ana Bell" })).getByText("On the map"),
    ).toBeInTheDocument();
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "1"));
    expect(map()).toHaveAccessibleName(/latest position of Ana Bell/);
    expect(screen.queryByRole("article", { name: "iPhone 16" })).not.toBeInTheDocument();
    expect(within(people()).getByRole("checkbox", { name: "Me" })).not.toBeChecked();
    // The last one chosen stays chosen.
    expect(within(people()).getByRole("checkbox", { name: "Ana Bell" })).toBeDisabled();
  });

  it("chooses everyone at once, and Me again", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    const everyone = within(await screen.findByRole("group", { name: "People" })).getByRole(
      "checkbox",
      { name: "Everyone" },
    );
    expect((everyone as HTMLInputElement).indeterminate).toBe(true);
    await person.click(everyone);
    expect(new URLSearchParams(router.state.location.search).get("people")).toBe(
      `me,${ids.ana},${ids.bob}`,
    );
    expect(everyone).toBeChecked();
    expect(within(card("bob")).getByText("On the map")).toBeInTheDocument();
    await person.click(everyone);
    expect(router.state.location.search).toBe("");
  });

  it("draws today's track of someone who shares history", async () => {
    const api = mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { url: `/?people=${ids.ana}`, user });
    await waitFor(() => expect(map()).toHaveAttribute("data-tracks", "1"));
    const call = api.calls.find((candidate) => candidate.path.endsWith("/track"));
    expect(call?.path).toBe(`/api/v1/people/${ids.ana}/track`);
  });

  it("tells in History who shares no history, and asks nothing of them", async () => {
    const api = mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { url: `/?view=history&people=me,${ids.ana},${ids.bob}`, user });
    expect(
      await screen.findByText("bob shares where they are now, not where they have been."),
    ).toBeInTheDocument();
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(await within(summary).findByText("Ana Bell · Ana’s iPhone")).toBeInTheDocument();
    expect(within(summary).getByText("iPhone 16")).toBeInTheDocument();
    const tracksAsked = api.calls.filter((call) => call.path.endsWith("/track"));
    expect(tracksAsked.map((call) => call.path)).toEqual([`/api/v1/people/${ids.ana}/track`]);
    expect(screen.getByRole("slider", { name: "Position at" })).toBeInTheDocument();
    // Me is chosen too: one's own timeline, visits and trips stay.
    expect(screen.getByRole("region", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Visits" })).toBeInTheDocument();
  });

  it("says so when a period reaches back before the history someone shares", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [anaWithHistory()] } },
      // The server moves `from` up to where the shared history begins: here past the period.
      [`GET /api/v1/people/${ids.ana}/track`]: ({ url }) => {
        const to = url.searchParams.get("to") ?? "";
        return { status: 200, body: { from: to, to, tracks: [] } };
      },
    });
    renderPage(<PeoplePage />, {
      url: `/?view=history&date=2026-09-01&people=me,${ids.ana}`,
      user,
    });
    expect(
      await screen.findByText("Ana Bell shares where they have been in the last 7 days only."),
    ).toBeInTheDocument();
  });

  it("keeps Heat to one's own devices", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: `/?view=heat&people=me,${ids.ana}`, user });
    expect(await screen.findByText("Your own devices only")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "People" })).not.toBeInTheDocument();
    const devices = screen.getByRole("group", { name: "Devices" });
    expect(within(devices).queryByRole("checkbox", { name: "Ana’s iPhone" })).toBeNull();
  });
});

describe("a card's Show on map", () => {
  it("shows that person alone, with only what can be shown of them", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    await person.click(
      within(await screen.findByRole("article", { name: "bob" })).getByRole("button", {
        name: "Show on map",
      }),
    );
    expect(router.state.location.search).toBe(`?people=${ids.bob}`);
    expect(within(card("bob")).getByText("On the map")).toBeInTheDocument();
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "1"));
    expect(map()).toHaveAccessibleName(/latest position of bob/);
    // One's own: no device cards, no levels and no heatmap while Me is not chosen.
    expect(within(meCard()).queryByText("On the map")).toBeNull();
    expect(screen.queryByRole("article", { name: "iPhone 16" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Uploads" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Detail of the tracks" })).not.toBeInTheDocument();
    expect(views()).toEqual(["Live", "History"]);
    expect(await screen.findByText("The map shows bob.")).toBeInTheDocument();

    // History of someone who shares none: a calm word, nothing asked, nothing of one's own.
    await person.click(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", {
        name: "History",
      }),
    );
    expect(
      await screen.findByText("bob shares where they are now, not where they have been."),
    ).toBeInTheDocument();
    for (const name of ["Summary", "Timeline", "Visits", "Trips"]) {
      expect(screen.queryByRole("region", { name }), name).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Nothing recorded/)).not.toBeInTheDocument();
    expect(map()).toHaveAccessibleName(/^Map\. Nothing to show for/);
    const asked = api.calls.map((call) => call.path);
    expect(asked).not.toContain(`/api/v1/people/${ids.bob}/track`);
    expect(asked).not.toContain("/api/visits");
    expect(asked).not.toContain("/api/trips");
  });

  it("asks for nothing of one's own while someone else is on the map alone", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: `/?people=${ids.bob}`, user });
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "1"));
    await person.click(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", {
        name: "History",
      }),
    );
    expect(
      await screen.findByText("bob shares where they are now, not where they have been."),
    ).toBeInTheDocument();
    const asked = new Set(api.calls.map((call) => call.path));
    for (const path of [
      "/api/tracks",
      "/api/v1/tracks",
      "/api/v1/segments",
      "/api/stats/activity",
      "/api/stats/days",
      "/api/visits",
      "/api/trips",
      "/api/heatmap",
      `/api/devices/${ids.phone}/ingest-log`,
      `/api/v1/people/${ids.bob}/track`,
    ]) {
      expect(asked.has(path), path).toBe(false);
    }
    // The Me card still sums one's devices up.
    expect(asked.has("/api/devices")).toBe(true);
  });

  it("shows someone's history alone without one's own timeline, visits or trips", async () => {
    mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { url: `/?view=history&people=${ids.ana}`, user });
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(await within(summary).findByText("Ana Bell · Ana’s iPhone")).toBeInTheDocument();
    expect(within(summary).queryByText("iPhone 16")).toBeNull();
    for (const name of ["Timeline", "Visits", "Trips"]) {
      expect(screen.queryByRole("region", { name }), name).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("group", { name: "Detail of the tracks" })).not.toBeInTheDocument();
    expect(map()).toHaveAccessibleName(/Their totals are listed on this page/);
  });

  it("says when someone who shares their history recorded nothing that day", async () => {
    mockApi({
      ...withHistoryOfAna(),
      [`GET /api/v1/people/${ids.ana}/track`]: ({ url }) => ({
        status: 200,
        body: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), tracks: [] },
      }),
    });
    renderPage(<PeoplePage />, { url: `/?view=history&people=${ids.ana}`, user });
    expect(await screen.findByText(/^Nothing recorded on/)).toBeInTheDocument();
    expect(
      screen.getByText("Only what Ana Bell shares with you appears here."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find a day with data" })).not.toBeInTheDocument();
  });

  it("only moves the camera to someone the map shows already", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?people=me,${ids.ana}`, user });
    await person.click(
      within(await screen.findByRole("article", { name: "Ana Bell" })).getByRole("button", {
        name: "Show on map",
      }),
    );
    expect(router.state.location.search).toBe(`?people=me,${ids.ana}`);
    expect(map().getAttribute("data-focus")).toMatch(new RegExp(`^show:${ids.ana}#`));
    expect(screen.getByRole("article", { name: "iPhone 16" })).toBeInTheDocument();
  });

  it("lets a later camera move of a view win, and never makes an old one again", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: `/?people=me,${ids.ana}`, user });
    await person.click(
      within(await screen.findByRole("article", { name: "Ana Bell" })).getByRole("button", {
        name: "Show on map",
      }),
    );
    expect(map().getAttribute("data-focus")).toMatch(/^show:/);
    const switchTo = (name: string) =>
      person.click(
        within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name }),
      );
    await switchTo("History");
    await person.click(await screen.findByRole("button", { name: /Show this visit on the map/ }));
    expect(map().getAttribute("data-focus")).toMatch(/^visit:/);
    await switchTo("Live");
    expect(map()).toHaveAttribute("data-focus", "");
  });

  it("brings Heat back with Me, the view the address asked for", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?view=heat&people=${ids.ana}`, user });
    // Heat is one's own: someone else alone is shown Live.
    expect(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name: "Live" }),
    ).toBeChecked();
    expect(views()).toEqual(["Live", "History"]);
    await person.click(within(meCard()).getByRole("button", { name: "Show on map" }));
    expect(router.state.location.search).toBe("?view=heat");
    expect(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name: "Heat" }),
    ).toBeChecked();
    expect(await screen.findByText("225,529")).toBeInTheDocument();
  });

  it("shows everyone, and the signed-in person alone again", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    await screen.findByRole("article", { name: "Ana Bell" });
    const everyone = screen.getByRole("button", { name: "Show everyone" });
    expect(everyone).toHaveAttribute("aria-pressed", "false");
    await person.click(everyone);
    expect(new URLSearchParams(router.state.location.search).get("people")).toBe(
      `me,${ids.ana},${ids.bob}`,
    );
    expect(everyone).toHaveAttribute("aria-pressed", "true");
    expect(within(card("Ana Bell")).getByText("On the map")).toBeInTheDocument();
    expect(within(card("bob")).getByText("On the map")).toBeInTheDocument();
    await person.click(everyone);
    expect(router.state.location.search).toBe("");
    expect(everyone).toHaveAttribute("aria-pressed", "false");
  });

  it("offers no Show everyone while one person shares", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [ana()] } },
    });
    renderPage(<PeoplePage />, { user });
    await screen.findByRole("article", { name: "Ana Bell" });
    expect(screen.queryByRole("button", { name: "Show everyone" })).not.toBeInTheDocument();
  });
});
