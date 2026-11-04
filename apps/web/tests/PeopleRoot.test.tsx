import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Person } from "@trail/contracts/person";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ana, bob, ids, seenAt, sharedDevice, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const sharing = () => screen.getByRole("list", { name: "Sharing with you" });

/** `count` people who share, each seen a minute apart, named from `names` first. */
function crowd(count: number, names: string[] = []): Person[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `0199a0f2-0000-7000-8000-${String(index).padStart(12, "0")}`;
    return ana({
      userId: id,
      displayName: names[index] ?? `Person ${String.fromCharCode(65 + index)}`,
      email: `p${index}@example.com`,
      share: { ...ana().share, id: `0199a0f3-0000-7000-8000-${String(index).padStart(12, "0")}` },
      devices: [
        seenAt(
          sharedDevice({ id: `0199a0f4-0000-7000-8000-${String(index).padStart(12, "0")}` }),
          new Date(Date.now() - (index + 1) * 60 * 60_000).toISOString(),
        ),
      ],
    });
  });
}

function hiddenShare(id: string, name: string) {
  return {
    id,
    owner: { userId: ids.ana, displayName: name, email: "x@example.com" },
    precision: "precise",
    historyDays: null,
    includeDetails: true,
    expiresAt: null,
    createdAt: "2026-10-20T08:00:00.000Z",
    hiddenAt: "2026-10-21T08:00:00.000Z",
  };
}

describe("the root of the sidebar", () => {
  it("has Share my location in the heading's row whoever shares", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [] } },
    });
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByRole("button", { name: "Share my location" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sharing with you" })).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("names the group of those who share, with the live ones first", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [bob(), ana()] } },
    });
    renderPage(<PeoplePage />, { user });
    await screen.findByRole("heading", { level: 2, name: "Sharing with you" });
    expect(
      within(sharing())
        .getAllByRole("link")
        .map((row) => row.getAttribute("href")),
    ).toEqual([`/?person=${ids.ana}`, `/?person=${ids.bob}`]);
  });

  it("offers a search from eight people, not from seven", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: crowd(7) } },
    });
    const seven = renderPage(<PeoplePage />, { user });
    await screen.findByRole("heading", { level: 2, name: "Sharing with you" });
    expect(screen.queryByRole("searchbox", { name: "Search people" })).toBeNull();
    seven.unmount();

    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: crowd(8) } },
    });
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByRole("searchbox", { name: "Search people" })).toBeInTheDocument();
  });

  it("filters only the people who share, ignoring case and accents, and says when no one matches", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": {
        status: 200,
        body: { people: crowd(8, ["José Álvarez", "Zoë"]) },
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await person.type(search, "JOSE");
    expect(within(sharing()).getAllByRole("link")).toHaveLength(1);
    expect(within(sharing()).getByRole("link", { name: /^José Álvarez/ })).toBeInTheDocument();
    // Me stays, whatever is typed.
    expect(screen.getByRole("link", { name: /^Me/ })).toBeInTheDocument();
    await person.clear(search);
    await person.type(search, "nobody");
    expect(screen.getByText("No one called “nobody”")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Sharing with you" })).toBeNull();
  });

  it("says what a search found after a short pause, in the live region", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: crowd(8, ["José Álvarez", "Zoë"]) } },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    const search = await screen.findByRole("searchbox", { name: "Search people" });
    // Real timers: the pause is 600 ms, and a key does not say anything before it.
    await person.type(search, "jose");
    expect(screen.queryByText("1 person")).toBeNull();
    expect(await screen.findByText("1 person", {}, { timeout: 2000 })).toBeInTheDocument();
    await person.clear(search);
    await person.type(search, "zzz");
    expect(
      await screen.findAllByText("No one called “zzz”", {}, { timeout: 2000 }),
    ).not.toHaveLength(0);
  });

  it("keeps the search when someone's page is opened and closed again", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: crowd(8, ["José Álvarez"]) } },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    await person.type(await screen.findByRole("searchbox", { name: "Search people" }), "jose");
    await person.click(await screen.findByRole("link", { name: /^José Álvarez/ }));
    await person.click(await screen.findByRole("link", { name: "Back to People" }));
    expect(await screen.findByRole("searchbox", { name: "Search people" })).toHaveValue("jose");
  });

  it("folds the people who started sharing into one row with one Dismiss", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": { status: 200, body: { people: [ana(), bob()] } },
    });
    const person = userEvent.setup();
    const { liveStore } = renderPage(<PeoplePage />, { user });
    await screen.findByRole("link", { name: /^Ana Bell/ });
    act(() => {
      liveStore.addShareNotice({ shareId: ids.anaShare, at: Date.now() });
      liveStore.addShareNotice({ shareId: ids.bobShare, at: Date.now() });
    });
    const status = screen.getByText("Ana Bell and bob share their location with you");
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
    await person.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/share their location with you/)).toBeNull();
  });
});

describe("the Hidden level", () => {
  const routes = (shares: ReturnType<typeof hiddenShare>[]) => ({
    ...standardRoutes(),
    "GET /api/v1/shares/incoming": { status: 200, body: { shares } },
  });

  it("is a row of the root only while someone is hidden", async () => {
    mockApi(routes([]));
    renderPage(<PeoplePage />, { user });
    await screen.findByRole("link", { name: /^Ana Bell/ });
    expect(screen.queryByRole("link", { name: /^Hidden/ })).toBeNull();
  });

  it("opens as a level of its own, with its name in focus and the way back to the row", async () => {
    mockApi(routes([hiddenShare(ids.anaShare, "Cleo"), hiddenShare(ids.bobShare, "Dan")]));
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    const row = await screen.findByRole("link", { name: "Hidden (2)" });
    await person.click(row);
    expect(router.state.location.search).toBe("?list=hidden");
    const heading = await screen.findByRole("heading", { level: 2, name: "Hidden" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("button", { name: "Show Cleo again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Dan again" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Me" })).toBeNull();

    await person.click(screen.getByRole("link", { name: "Back to People" }));
    expect(router.state.location.search).toBe("");
    expect(await screen.findByRole("link", { name: "Hidden (2)" })).toHaveFocus();
  });

  it("shows someone again, and says when nobody is hidden", async () => {
    let hidden = true;
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/shares/incoming": () => ({
        status: 200,
        body: { shares: hidden ? [hiddenShare(ids.anaShare, "Cleo")] : [] },
      }),
      [`POST /api/v1/shares/incoming/${ids.anaShare}/unhide`]: () => {
        hidden = false;
        return { status: 200, body: { share: hiddenShare(ids.anaShare, "Cleo") } };
      },
    });
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?list=hidden", user });
    await person.click(await screen.findByRole("button", { name: "Show Cleo again" }));
    expect(await screen.findByText("Nobody is hidden.")).toBeInTheDocument();
    await waitFor(() => expect(hidden).toBe(false));
  });
});
