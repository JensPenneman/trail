import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { openGroup } from "./support/openGroup";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";
import { withHistoryOfAna } from "./support/withHistoryOfAna";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const view = (name: string) =>
  within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name });
const me = () => screen.findByRole("region", { name: "Me" });
const expanded = (button: HTMLElement) => button.getAttribute("aria-expanded") === "true";

describe("Me's page", () => {
  it("opens the Timeline group in Live, and keeps the other groups folded in History", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?person=me&view=history", user });
    const page = await me();
    expect(within(page).getByRole("button", { name: "Timeline" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const group = within(page).getByRole("button", { name: "Summary, visits and trips" });
    expect(expanded(group)).toBe(false);
    // Nothing of the group is there, nor asked for, until it is opened.
    expect(screen.queryByRole("region", { name: "Visits" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Trips" })).toBeNull();
    await person.click(group);
    expect(await screen.findByRole("region", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Visits" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Trips" })).toBeInTheDocument();
  });

  it("keeps a group as one left it while the view changes", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?person=me&view=history", user });
    await openGroup(person, "Summary, visits and trips");
    await person.click(view("Live"));
    expect(await screen.findByRole("region", { name: "Your day so far" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Summary, visits and trips" })).toBeNull();
    await person.click(view("History"));
    expect(
      await screen.findByRole("button", { name: "Summary, visits and trips" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Visits" })).toBeInTheDocument();
    // Timeline stays open too: closing it in History closes it in Live.
    await person.click(screen.getByRole("button", { name: "Timeline" }));
    await person.click(view("Live"));
    expect(await screen.findByRole("button", { name: "Timeline" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("asks for the 12-month totals of Heat only once its group is opened", async () => {
    const api = mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?person=me&view=heat", user });
    const group = await screen.findByRole("button", { name: "Heat: totals, busiest places" });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(api.calls.some((call) => call.path === "/api/stats/days")).toBe(false);
    // The key of the map's colours is the map's, not the group's.
    expect(
      await screen.findByRole("list", { name: "Points recorded in each square" }),
    ).toBeInTheDocument();
    await person.click(group);
    expect(await screen.findByText("225,529")).toBeInTheDocument();
    expect(api.calls.some((call) => call.path === "/api/stats/days")).toBe(true);
    expect(screen.getByRole("region", { name: "Busiest places in view" })).toBeInTheDocument();
  });

  it("has a row to one's devices with their count, and one to Settings › Sharing", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?person=me", user });
    const page = await me();
    const devices = await within(page).findByRole("link", { name: /^Your devices/ });
    expect(devices).toHaveAccessibleName("Your devices 2");
    expect(devices).toHaveAttribute("href", "/?person=me&list=devices");
    const sharing = await within(page).findByRole("link", { name: /^Sharing/ });
    expect(sharing).toHaveAccessibleName("Sharing You share with 1 person");
    expect(sharing).toHaveAttribute("href", "/settings/sharing");
  });

  it("says how many devices in the header, and nothing of them in the page itself", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?person=me", user });
    const page = await me();
    expect(await within(page).findByText("2 devices")).toBeInTheDocument();
    expect(within(page).queryByText("iPhone 16")).toBeNull();
  });
});

describe("someone else's page", () => {
  it("folds their devices and what they share, and has the rows of what can be done", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: `/?person=${ids.ana}&view=history`, user });
    const page = await screen.findByRole("region", { name: "Ana Bell" });
    const devices = within(page).getByRole("button", {
      name: "Device (1) · What Ana Bell shares with you",
    });
    expect(expanded(devices)).toBe(false);
    expect(within(page).queryByText("Ana’s iPhone")).toBeNull();
    await person.click(devices);
    expect(within(page).getByText("Ana’s iPhone")).toBeInTheDocument();
    expect(within(page).getByText("Precision", { selector: "dt" })).toBeInTheDocument();
    // What can be done, as rows: the spot in other apps, in a new tab; share back; hide.
    const apple = within(page).getByRole("link", { name: /^Open in Apple Maps/ });
    expect(apple).toHaveAttribute("target", "_blank");
    expect(within(page).getByRole("link", { name: /^Open in Google Maps/ })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(within(page).getByText("You share with Ana Bell")).toBeInTheDocument();
    expect(
      within(page).getByRole("button", { name: "Stop sharing your location with Ana Bell" }),
    ).toBeInTheDocument();
    expect(within(page).getByRole("button", { name: "Hide Ana Bell" })).toBeInTheDocument();
    // Ana shares live only: there is no history, so no Summary group.
    expect(within(page).queryByRole("button", { name: "Summary" })).toBeNull();
  });

  it("has no Summary group in Live, where there is no summary", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: `/?person=${ids.ana}`, user });
    const page = await screen.findByRole("region", { name: "Ana Bell" });
    expect(within(page).queryByRole("button", { name: "Summary" })).toBeNull();
    expect(
      within(page).getByRole("button", { name: "Device (1) · What Ana Bell shares with you" }),
    ).toBeInTheDocument();
  });

  it("offers to share back to someone one does not share with", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: `/?person=${ids.bob}`, user });
    const page = await screen.findByRole("region", { name: "bob" });
    await waitFor(() =>
      expect(within(page).getByRole("button", { name: "Share back with bob" })).toBeInTheDocument(),
    );
    expect(within(page).queryByText(/^You share with bob/)).toBeNull();
  });

  it("folds their History summary, opens it on a click, and says nothing recorded at the map's foot", async () => {
    mockApi(withHistoryOfAna());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: `/?person=${ids.ana}&view=history`, user });
    const page = await screen.findByRole("region", { name: "Ana Bell" });
    const summary = await within(page).findByRole("button", { name: "Summary" });
    expect(expanded(summary)).toBe(false);
    expect(within(page).queryByRole("region", { name: "Summary" })).toBeNull();
    await person.click(summary);
    const region = await within(page).findByRole("region", { name: "Summary" });
    expect(await within(region).findByText("Ana Bell · Ana’s iPhone")).toBeInTheDocument();
    // Headings inside the group are under its own (h3 -> h4): none is a sibling of the button's.
    expect(within(page).getByRole("heading", { level: 3, name: "Summary" })).toBeInTheDocument();
  });

  it("says at the map's foot, not in the page, what someone's day lacks", async () => {
    mockApi({
      ...withHistoryOfAna(),
      [`GET /api/v1/people/${ids.ana}/track`]: ({ url }) => ({
        status: 200,
        body: { from: url.searchParams.get("from"), to: url.searchParams.get("to"), tracks: [] },
      }),
    });
    renderPage(<PeoplePage />, { url: `/?person=${ids.ana}&view=history`, user });
    // On phones the foot is the first block of the page's sheet; beside the map it floats over
    // the map. Either way it is not in a group: the Summary group has no such card.
    expect(await screen.findByText(/^Nothing recorded on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Summary" })).toBeNull();
    expect(
      screen.getByText("Only what Ana Bell shares with you appears here."),
    ).toBeInTheDocument();
  });

  it("says at the map's foot that someone's tracks could not be loaded", async () => {
    mockApi({
      ...withHistoryOfAna(),
      [`GET /api/v1/people/${ids.ana}/track`]: {
        status: 503,
        body: { error: { code: "unavailable", message: "Database down" } },
      },
    });
    renderPage(<PeoplePage />, { url: `/?person=${ids.ana}&view=history`, user });
    expect(await screen.findByText("Tracks of people could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Database down")).toBeInTheDocument();
  });
});
