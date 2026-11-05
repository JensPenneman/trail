import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { paramsOf } from "./support/addressParams";
import { ana, bob, ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { openGroup } from "./support/openGroup";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";
import { anaWithHistory, trackOfAna, withHistoryOfAna } from "./support/withHistoryOfAna";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const map = () => screen.getByRole("img", { name: /^(Map|Heatmap)\b/ });
const views = () =>
  within(screen.getByRole("group", { name: "Map view" }))
    .getAllByRole("radio")
    .map((radio) => radio.closest("label")?.textContent);
const personLink = (name: RegExp) => screen.findByRole("link", { name });
/** The part of someone's detail that says where they have been, under its heading. */
async function whereBeen(name: string): Promise<HTMLElement> {
  const heading = await within(await screen.findByRole("region", { name })).findByRole("heading", {
    name: "Where they’ve been",
  });
  const part = heading.parentElement;
  if (part === null) throw new Error("A heading without its part");
  return part;
}
const tracksAsked = (api: { calls: { path: string }[] }) =>
  api.calls.filter((call) => /^\/api\/(v1\/)?tracks$|\/track$/.test(call.path));
describe("the overview, nobody selected", () => {
  it("shows everyone's position and asks for no track, level or timeline at all", async () => {
    const api = mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { user });
    await waitFor(() => expect(map()).toHaveAttribute("data-positions", "4"));
    expect(map()).toHaveAccessibleName("Map of where everyone is now: you, Ana Bell and bob.");
    expect(map()).toHaveAttribute("data-tracks", "0");
    expect(map()).toHaveAttribute("data-transport", "0");
    expect(screen.queryByRole("region", { name: "Your day so far" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Detail of the tracks" })).toBeNull();
    await screen.findByRole("link", { name: /^Ana Bell/ });
    expect(api.calls.filter((call) => /track|segments/.test(call.path))).toEqual([]);
    expect(views()).toEqual(["Live", "History", "Heat"]);
    // Nobody is highlighted, and the list says nothing of "the map shows".
    expect(screen.queryByText("On the map")).toBeNull();
  });

  it("frames nobody in particular until someone is selected", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { user });
    await waitFor(() => expect(map().getAttribute("data-fit")).toMatch(/^live\|everyone\|/));
  });

  it("is what a link from before the single selection means with several people", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: `/?people=me,${ids.ana}`, user });
    expect(await screen.findByRole("list", { name: "Me" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Me" })).toBeNull();
  });
});

describe("selecting a person", () => {
  it("keeps the view, day and style of the page, and drops the filter of the last person", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=history&date=2026-09-12&style=dark&level=raw",
      user,
    });
    await person.click(await personLink(/^Ana Bell/));
    expect(router.state.location.search).toBe(
      `?view=history&date=2026-09-12&style=dark&level=raw&person=${ids.ana}`,
    );
    // Back and Forward work: a selection is a step of its own.
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByRole("list", { name: "Me" })).toBeInTheDocument();
  });

  it("draws someone else's track alone, in Live, with everyone's markers kept", async () => {
    const api = mockApi(withHistoryOfAna());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    await person.click(await personLink(/^Ana Bell/));
    expect(router.state.location.search).toBe(`?person=${ids.ana}`);
    await waitFor(() => expect(map()).toHaveAttribute("data-tracks", "1"));
    expect(map()).toHaveAttribute("data-positions", "4");
    expect(map()).toHaveAccessibleName(
      /^Map of Ana Bell’s track today and where everyone is now: you, Ana Bell and bob\./,
    );
    expect(tracksAsked(api).map((call) => call.path)).toEqual([`/api/v1/people/${ids.ana}/track`]);
    // Heat is one's own, and so are the levels, the timeline and the devices.
    expect(views()).toEqual(["Live", "History"]);
    expect(screen.queryByRole("group", { name: "Detail of the tracks" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Your day so far" })).toBeNull();
    expect(screen.queryByText("Advanced")).toBeNull();
    expect(map().getAttribute("data-fit")).toMatch(new RegExp(`^live\\|${ids.ana}\\|`));
  });

  it("asks nothing of someone who shares live only, and says so in their detail", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    await person.click(await personLink(/^bob/));
    const bob = await screen.findByRole("region", { name: "bob" });
    expect(await within(bob).findByText("Shares live location only")).toBeInTheDocument();
    expect(map()).toHaveAttribute("data-tracks", "0");
    expect(tracksAsked(api)).toEqual([]);
    // No track is drawn, so the map does not promise one.
    expect(map()).toHaveAccessibleName(/^Map of where everyone is now/);
  });

  it("keeps Share my location when the people could not be loaded", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": {
        status: 503,
        body: { error: { code: "unavailable", message: "Database down" } },
      },
    });
    renderPage(<PeoplePage />, { user });
    expect(await screen.findByText("People could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share my location" })).toBeEnabled();
  });

  it("draws one's own track and day so far with Me, and offers Heat and the levels", async () => {
    const api = mockApi(withHistoryOfAna());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { user });
    await person.click(await personLink(/^Me/));
    await waitFor(() => expect(map()).not.toHaveAttribute("data-transport", "0"));
    expect(map()).toHaveAccessibleName(/^Map of your track today and where everyone is now/);
    expect(await screen.findByRole("region", { name: "Your day so far" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Detail of the tracks" })).toBeInTheDocument();
    expect(views()).toEqual(["Live", "History", "Heat"]);
    // Not Ana's track: that is for when she is selected.
    expect(api.calls.some((call) => call.path.endsWith(`/people/${ids.ana}/track`))).toBe(false);
    // The devices to choose among are Me's own.
    await person.click(screen.getByText("Advanced"));
    const devices = screen.getByRole("group", { name: "Devices" });
    expect(within(devices).getByRole("checkbox", { name: "iPhone 16" })).toBeChecked();
    expect(within(devices).queryByRole("checkbox", { name: "Ana’s iPhone" })).toBeNull();
  });

  it("falls back to Live for someone else and brings Heat back with Me", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?view=heat&person=${ids.ana}`, user });
    expect(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name: "Live" }),
    ).toBeChecked();
    expect(views()).toEqual(["Live", "History"]);
    await person.click(await screen.findByRole("link", { name: "Back to People" }));
    expect(router.state.location.search).toBe("?view=heat");
    expect(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name: "Heat" }),
    ).toBeChecked();
    await person.click(await personLink(/^Me/));
    await openGroup(person, "Heat: totals, busiest places");
    expect(await screen.findByText("225,529")).toBeInTheDocument();
    // The old "Your own devices only" notice has no one to speak to any more.
    expect(screen.queryByText("Your own devices only")).toBeNull();
  });

  it("moves the focus to the name, and back to the person's row on leaving", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { user });
    await person.click(await personLink(/^Ana Bell/));
    expect(await screen.findByRole("heading", { level: 2, name: "Ana Bell" })).toHaveFocus();
    // The browser's Back is leaving too.
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await personLink(/^Ana Bell/)).toHaveFocus();
  });
});

describe("a link that implies a person", () => {
  it("is rewritten with the person once the lists are in, not before", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockApi({
      ...standardRoutes(),
      "GET /api/v1/people": async () => {
        await gate;
        return { status: 200, body: { people: [ana(), bob()] } };
      },
    });
    const { router } = renderPage(<PeoplePage />, { url: `/?devices=${ids.anaPhone}`, user });
    // The people are pending: whose device it is is not known yet (Me is the guess, not written).
    await screen.findByRole("region", { name: "Me" });
    expect(router.state.location.search).toBe(`?devices=${ids.anaPhone}`);
    act(() => release());
    await waitFor(() =>
      expect(paramsOf(router.state.location.search)).toEqual([
        ["devices", ids.anaPhone],
        ["person", ids.ana],
      ]),
    );
    const heading = await screen.findByRole("heading", { level: 2, name: "Ana Bell" });
    // Nobody asked for it: the focus stays where the page put it.
    expect(heading).not.toHaveFocus();
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("rewrites ?people= with one person, and keeps the detail", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(<PeoplePage />, { url: `/?people=${ids.ana}`, user });
    await waitFor(() =>
      expect(paramsOf(router.state.location.search)).toEqual([["person", ids.ana]]),
    );
    expect(await screen.findByRole("region", { name: "Ana Bell" })).toBeInTheDocument();
  });
});

describe("a view switch next to an implied selection", () => {
  it("is not undone by the address being rewritten with the person", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?devices=${ids.phone}`, user });
    await screen.findByRole("region", { name: "Me" });
    await person.click(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", {
        name: "History",
      }),
    );
    // Whichever of the two lands first, both are in the address in the end.
    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get("view")).toBe("history");
      expect(params.get("person")).toBe("me");
    });
    expect(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", {
        name: "History",
      }),
    ).toBeChecked();
  });
});

describe("Heat's device filter", () => {
  it("narrows one's own heatmap without selecting anyone or moving the focus", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: "/?view=heat", user });
    await person.click(await screen.findByText("Advanced"));
    const car = screen.getByRole("checkbox", { name: "Car" });
    await person.click(car);
    expect(router.state.location.search).toBe(`?view=heat&devices=${ids.phone}`);
    expect(car).toHaveFocus();
    expect(screen.getByRole("list", { name: "Me" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Me" })).toBeNull();
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.path === "/api/heatmap" && call.url?.includes(ids.phone) === true,
        ),
      ).toBe(true),
    );
    // Leaving Heat leaves its filter: it would imply Me, and the switch would be lost.
    const live = within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", {
      name: "Live",
    });
    await person.click(live);
    expect(live).toBeChecked();
    expect(live).toHaveFocus();
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(screen.getByRole("list", { name: "Me" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Me" })).toBeNull();
  });
});

describe("History's overview and selections", () => {
  it("draws one's own tracks and everyone's with a history share, and skips the rest of one's own", async () => {
    const api = mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { url: "/?view=history", user });
    await screen.findByRole("list", { name: "Me" });
    // The root has no summary: what History shows of the people is the map's, and their pages'.
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(await screen.findByRole("img", { name: /^Map of the tracks for/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(`/api/v1/people/${ids.ana}/track`),
    );
    // Only Ana shares history; bob is a live-only share and asks for nothing.
    const asked = api.calls.map((call) => call.path);
    expect(asked.filter((path) => path.endsWith("/track"))).toEqual([
      `/api/v1/people/${ids.ana}/track`,
    ]);
    expect(asked).toContain("/api/v1/tracks");
    for (const path of ["/api/visits", "/api/trips", "/api/v1/segments"]) {
      expect(asked, path).not.toContain(path);
    }
    expect(screen.queryByRole("region", { name: "Timeline" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Visits" })).toBeNull();
    expect(screen.getByRole("slider", { name: "Position at" })).toBeInTheDocument();
  });

  it("adds the timeline, visits and trips with Me, and not Ana's track", async () => {
    const api = mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { url: "/?view=history&person=me", user });
    expect(await screen.findByRole("region", { name: "Timeline" })).toBeInTheDocument();
    // Summary, visits and trips are one folded group: nothing of them until it is opened.
    expect(screen.queryByRole("region", { name: "Visits" })).toBeNull();
    await openGroup(userEvent.setup(), "Summary, visits and trips");
    expect(await screen.findByRole("region", { name: "Visits" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Trips" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Summary" })).toBeInTheDocument();
    expect(api.calls.some((call) => call.path.endsWith("/track"))).toBe(false);
  });

  it("shows someone's history alone: their summary, nothing of one's own", async () => {
    const api = mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { url: `/?view=history&person=${ids.ana}`, user });
    await openGroup(userEvent.setup(), "Summary");
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(await within(summary).findByText("Ana Bell · Ana’s iPhone")).toBeInTheDocument();
    expect(within(summary).queryByText("iPhone 16")).toBeNull();
    for (const name of ["Timeline", "Visits", "Trips"]) {
      expect(screen.queryByRole("region", { name }), name).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("group", { name: "Detail of the tracks" })).toBeNull();
    expect(map()).toHaveAccessibleName(
      /^Map of Ana Bell’s tracks for .* Their totals are on their page/,
    );
    const asked = new Set(api.calls.map((call) => call.path));
    for (const path of [
      "/api/tracks",
      "/api/v1/tracks",
      "/api/v1/segments",
      "/api/visits",
      "/api/trips",
      "/api/heatmap",
    ]) {
      expect(asked.has(path), path).toBe(false);
    }
  });

  it("says when someone who shares their history recorded nothing that day", async () => {
    mockApi({
      ...withHistoryOfAna(),
      [`GET /api/v1/people/${ids.ana}/track`]: ({ url }) => ({
        status: 200,
        body: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), tracks: [] },
      }),
    });
    renderPage(<PeoplePage />, { url: `/?view=history&person=${ids.ana}`, user });
    expect(await screen.findByText(/^Nothing recorded on/)).toBeInTheDocument();
    expect(
      screen.getByText("Only what Ana Bell shares with you appears here."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find a day with data" })).not.toBeInTheDocument();
  });

  it("calls for no summary of someone who shares no history", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: `/?view=history&person=${ids.bob}`, user });
    const bob = await screen.findByRole("region", { name: "bob" });
    expect(within(bob).getByText("Shares live location only")).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: /^Map\. Nothing to show for/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Totals" })).toBeNull();
    expect(screen.queryByText(/Nothing recorded/)).toBeNull();
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
      url: `/?view=history&date=2026-09-01&person=${ids.ana}`,
      user,
    });
    const where = await whereBeen("Ana Bell");
    expect(await within(where).findByText("Shares the last 7 days only")).toBeInTheDocument();
  });
});

describe("where the selected person has been", () => {
  const where = whereBeen;

  it("is in their detail in Live: today's track, and a day back is History's", async () => {
    mockApi(withHistoryOfAna());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?person=${ids.ana}`, user });
    const section = await where("Ana Bell");
    expect(within(section).getByText("Today")).toBeInTheDocument();
    // Her track today: 1.3 km, the first and last point at 07:00 and 07:02 (Brussels).
    expect(
      await within(section).findByText(/^1\.3 km · \d\d:\d\d – \d\d:\d\d$/),
    ).toBeInTheDocument();
    // At today Next day is inert, not disabled: a disabled button would drop the keyboard's focus.
    expect(within(section).getByRole("button", { name: "Next day" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      within(section).getByRole("button", { name: "Previous day" }),
    ).toHaveAccessibleDescription("Ana Bell");
    await person.click(within(section).getByRole("button", { name: "Previous day" }));
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("view")).toBe("history");
    expect(params.get("person")).toBe(ids.ana);
    expect(params.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // History's day, stepped back and forth from the detail.
    const again = await where("Ana Bell");
    expect(within(again).queryByText("Today")).toBeNull();
    await person.click(within(again).getByRole("button", { name: "Next day" }));
    expect(new URLSearchParams(router.state.location.search).get("date")).toBeNull();
  });

  it("says when nothing was recorded, and the period of History's range", async () => {
    mockApi({
      ...withHistoryOfAna(),
      [`GET /api/v1/people/${ids.ana}/track`]: ({ url }) => ({
        status: 200,
        body: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), tracks: [] },
      }),
    });
    renderPage(<PeoplePage />, {
      url: `/?view=history&from=2026-09-01&to=2026-09-07&person=${ids.ana}`,
      user,
    });
    const section = await where("Ana Bell");
    expect(within(section).getByText(/1 Sept – .*7 Sept/)).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Previous day" })).toBeNull();
    expect(await within(section).findByText("Nothing recorded in this period")).toBeInTheDocument();
  });

  it("steps no further back than their history, keeps Next day's focus, and says each day", async () => {
    // Ana shares her last 24 hours: yesterday is as far back as it goes.
    mockApi({
      ...withHistoryOfAna(),
      "GET /api/v1/people": {
        status: 200,
        body: { people: [ana({ share: { ...ana().share, historyDays: 1 } })] },
      },
    });
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url: `/?person=${ids.ana}`, user });
    const dateNow = () => new URLSearchParams(router.state.location.search).get("date");
    await person.click(
      within(await where("Ana Bell")).getByRole("button", { name: "Previous day" }),
    );
    expect(await screen.findByText(/^History, \w+, \d+ \w+ \d{4}\.$/)).toBeInTheDocument();
    const yesterday = dateNow();
    expect(yesterday).not.toBeNull();
    const back = within(await where("Ana Bell")).getByRole("button", { name: "Previous day" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    await person.click(back);
    expect(dateNow()).toBe(yesterday);

    const next = within(await where("Ana Bell")).getByRole("button", { name: "Next day" });
    next.focus();
    await person.keyboard("{Enter}");
    expect(dateNow()).toBeNull();
    expect(await screen.findByText("Today.")).toBeInTheDocument();
    // Today: inert, and still where the keyboard is.
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveFocus();
  });

  it("says when two devices recorded, the times in words, and a share without devices", async () => {
    mockApi({
      ...withHistoryOfAna(),
      "GET /api/v1/people": {
        status: 200,
        body: {
          people: [
            anaWithHistory(),
            {
              ...bob(),
              share: { ...bob().share, precision: "precise", historyDays: 7 },
              devices: [],
            },
          ],
        },
      },
      [`GET /api/v1/people/${ids.ana}/track`]: ({ url }) => {
        const answer = trackOfAna({ url });
        const [phone] = answer.body.tracks;
        if (phone === undefined) throw new Error("no track");
        // Her iPad rode along: one ride, two devices.
        const tablet = { ...phone, deviceId: "01926f3c-2e5f-7a71-8243-5d6e7f8091ff" };
        return { ...answer, body: { ...answer.body, tracks: [phone, tablet] } };
      },
    });
    const { unmount } = renderPage(<PeoplePage />, { url: `/?person=${ids.ana}`, user });
    const section = await where("Ana Bell");
    expect(
      await within(section).findByText(/^1\.3 km · \d\d:\d\d – \d\d:\d\d · 2 devices recorded$/),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(/^1\.3 km, from \d\d:\d\d to \d\d:\d\d, 2 devices recorded$/),
    ).toHaveClass("visually-hidden");
    unmount();
    renderPage(<PeoplePage />, { url: `/?person=${ids.bob}`, user });
    expect(within(await where("bob")).getByText("Shares no device right now")).toBeInTheDocument();
  });

  it("does not make a visit's camera move again once the detail stepped to another day", async () => {
    mockApi(withHistoryOfAna());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=history&person=me", user });
    await openGroup(person, "Summary, visits and trips");
    await person.click(await screen.findByRole("button", { name: /Show this visit on the map/ }));
    expect(map().getAttribute("data-focus")).toMatch(/^visit:/);
    await person.click(await screen.findByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(map()).toHaveAttribute("data-focus", ""));
  });

  it("does not make a visit's camera move again back on its day either (Back)", async () => {
    mockApi(withHistoryOfAna());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=history&person=me",
      user,
    });
    await openGroup(person, "Summary, visits and trips");
    await person.click(await screen.findByRole("button", { name: /Show this visit on the map/ }));
    expect(map().getAttribute("data-focus")).toMatch(/^visit:/);
    await person.click(await screen.findByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(map()).toHaveAttribute("data-focus", ""));
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(router.state.location.search).not.toMatch(/date=/));
    expect(map().getAttribute("data-focus")).not.toMatch(/^visit:/);
  });

  it("is only there while they are selected", async () => {
    mockApi(withHistoryOfAna());
    renderPage(<PeoplePage />, { user });
    await screen.findByRole("link", { name: /^Ana Bell/ });
    expect(screen.queryByRole("heading", { name: "Where they’ve been" })).toBeNull();
  });
});
