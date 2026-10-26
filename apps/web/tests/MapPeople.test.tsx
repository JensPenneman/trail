import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapPage } from "../src/pages/map/MapPage";
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

describe("people on the map", () => {
  it("are offered beside Me, and the map shows only the signed-in person at first", async () => {
    mockApi(standardRoutes());
    renderPage(<MapPage />, { user });
    expect(
      within(await screen.findByRole("group", { name: "People" })).getByRole("checkbox", {
        name: "Me",
      }),
    ).toBeChecked();
    expect(within(people()).getByRole("checkbox", { name: "Ana Bell" })).not.toBeChecked();
    expect(within(people()).getByRole("checkbox", { name: "bob" })).not.toBeChecked();
    expect(within(people()).getByRole("checkbox", { name: "Everyone" })).not.toBeChecked();
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "2"));
    expect(screen.queryByRole("article", { name: "Ana Bell" })).not.toBeInTheDocument();
  });

  it("adds someone with their card and marker, and asks for no history they do not share", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<MapPage />, { user });
    await person.click(
      within(await screen.findByRole("group", { name: "People" })).getByRole("checkbox", {
        name: "Ana Bell",
      }),
    );
    expect(router.state.location.search).toBe(`?people=me%2C${ids.ana}`);
    const card = await screen.findByRole("article", { name: "Ana Bell" });
    expect(within(card).getByRole("button", { name: "Show on map" })).toBeEnabled();
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "3"));
    expect(screen.getByRole("article", { name: "iPhone 16" })).toBeInTheDocument();
    // Live only: there is no track of Ana to ask for.
    expect(api.calls.some((call) => call.path.endsWith("/track"))).toBe(false);
    // The device filter now lists her shared device under her name.
    const devices = screen.getByRole("group", { name: "Devices" });
    expect(within(devices).getByRole("group", { name: "Ana Bell" })).toBeInTheDocument();
    expect(within(devices).getByRole("checkbox", { name: "Ana’s iPhone" })).toBeChecked();
  });

  it("shows only the person a deep link names", async () => {
    mockApi(standardRoutes());
    renderPage(<MapPage />, { url: `/?view=live&people=${ids.ana}`, user });
    expect(await screen.findByRole("article", { name: "Ana Bell" })).toBeInTheDocument();
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
    const { router } = renderPage(<MapPage />, { user });
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
    expect(await screen.findByRole("article", { name: "bob" })).toBeInTheDocument();
    await person.click(everyone);
    expect(router.state.location.search).toBe("");
  });

  it("draws today's track of someone who shares history", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [anaWithHistory(), bob()] } },
      [`GET /api/v1/people/${ids.ana}/track`]: trackOfAna,
    });
    renderPage(<MapPage />, { url: `/?people=${ids.ana}`, user });
    await waitFor(() => expect(map()).toHaveAttribute("data-tracks", "1"));
    const call = api.calls.find((candidate) => candidate.path.endsWith("/track"));
    expect(call?.path).toBe(`/api/v1/people/${ids.ana}/track`);
  });

  it("tells in History who shares no history, and asks nothing of them", async () => {
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [anaWithHistory(), bob()] } },
      [`GET /api/v1/people/${ids.ana}/track`]: trackOfAna,
    });
    renderPage(<MapPage />, { url: `/?view=history&people=me,${ids.ana},${ids.bob}`, user });
    expect(
      await screen.findByText("bob shares where they are now, not where they have been."),
    ).toBeInTheDocument();
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(await within(summary).findByText("Ana Bell · Ana’s iPhone")).toBeInTheDocument();
    expect(within(summary).getByText("iPhone 16")).toBeInTheDocument();
    const tracksAsked = api.calls.filter((call) => call.path.endsWith("/track"));
    expect(tracksAsked.map((call) => call.path)).toEqual([`/api/v1/people/${ids.ana}/track`]);
    expect(screen.getByRole("slider", { name: "Position at" })).toBeInTheDocument();
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
    renderPage(<MapPage />, {
      url: `/?view=history&date=2026-09-01&people=me,${ids.ana}`,
      user,
    });
    expect(
      await screen.findByText("Ana Bell shares where they have been in the last 7 days only."),
    ).toBeInTheDocument();
  });

  it("keeps Heat to one's own devices", async () => {
    mockApi(standardRoutes());
    renderPage(<MapPage />, { url: `/?view=heat&people=me,${ids.ana}`, user });
    expect(await screen.findByText("Your own devices only")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "People" })).not.toBeInTheDocument();
    const devices = screen.getByRole("group", { name: "Devices" });
    expect(within(devices).queryByRole("checkbox", { name: "Ana’s iPhone" })).toBeNull();
  });
});
