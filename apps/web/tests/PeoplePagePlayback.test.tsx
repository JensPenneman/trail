import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";
import { withHistoryOfAna } from "./support/withHistoryOfAna";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

const url = "/?view=history&person=me&date=2026-09-12";

describe("playing History back", () => {
  it("replaces the sidebar by the moment, and leaves the address alone while it plays", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url, user });
    expect(await screen.findByRole("region", { name: "Me" })).toBeInTheDocument();
    await person.click(await screen.findByRole("button", { name: "Play" }));

    expect(await screen.findByRole("region", { name: "Playback" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "At this moment" })).toBeInTheDocument();
    // The sidebar stays mounted but is hidden from everyone, and the address does not move.
    expect(screen.queryByRole("region", { name: "Me" })).not.toBeInTheDocument();
    expect(router.state.location.search).toBe("?view=history&person=me&date=2026-09-12");
  });

  it("writes the moment to the address when it is paused", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url, user });
    await person.click(await screen.findByRole("button", { name: "Play" }));
    await person.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("at")).toMatch(
        /^2026-09-12T\d\d:\d\d$/,
      ),
    );
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("date")).toBe("2026-09-12");
    expect(params.get("person")).toBe("me");
  });

  it("is left with Escape, and the focus is back on the slider's Play", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url, user });
    await person.click(await screen.findByRole("button", { name: "Play" }));
    await screen.findByRole("region", { name: "Playback" });
    await person.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Playback" })).toBeNull());
    expect(await screen.findByRole("region", { name: "Me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toHaveFocus();
  });

  it("asks for a sharer's days from the days endpoint", async () => {
    const api = mockApi(withHistoryOfAna());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, {
      url: `/?view=history&person=${ids.ana}&date=2026-09-12`,
      user,
    });
    await person.click(await screen.findByRole("button", { name: "Play" }));
    await screen.findByRole("region", { name: "Playback" });
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === `/api/v1/people/${ids.ana}/days`)).toBe(true),
    );
    expect(within(document.body).queryByRole("region", { name: "At this moment" })).not.toBeNull();
  });

  it("names the page's one heading for what is on screen while the sidebar is hidden", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url, user });
    await person.click(await screen.findByRole("button", { name: "Play" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "History playback" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1, name: "People" })).not.toBeInTheDocument();
  });

  it("has no Play while nobody is selected", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=history&date=2026-09-12", user });
    await screen.findByRole("slider", { name: "Position at" });
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
  });

  it("writes where it was left when it is left after a seek made while paused", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url, user });
    await person.click(await screen.findByRole("button", { name: "Play" }));
    await person.click(await screen.findByRole("button", { name: "Pause" }));
    const slider = await screen.findByRole("slider", { name: "Position at" });
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("at")).not.toBeNull(),
    );
    const paused = new URLSearchParams(router.state.location.search).get("at");
    fireEvent.change(slider, {
      target: { value: String(Number(slider.getAttribute("min")) + 30) },
    });
    await person.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Playback" })).toBeNull());
    const left = new URLSearchParams(router.state.location.search).get("at");
    expect(left).toMatch(/^2026-09-12T\d\d:\d\d$/);
    expect(left).not.toBe(paused);
  });

  it("ends without writing the moment when the view changes", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<PeoplePage />, { url, user });
    await person.click(await screen.findByRole("button", { name: "Play" }));
    await screen.findByRole("region", { name: "Playback" });
    await person.click(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", { name: "Live" }),
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Playback" })).toBeNull());
    expect(new URLSearchParams(router.state.location.search).get("at")).toBeNull();
    // Live is the default view: the address names none.
    expect(new URLSearchParams(router.state.location.search).get("view")).not.toBe("history");
  });

  it("dims what lies after the cursor, follows the cursors and redraws the tracks rarely", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url, user });
    // From between the first two points of the day's track, so that the rest lies ahead.
    const scrubber = await screen.findByRole("slider", { name: "Position at" });
    fireEvent.change(scrubber, {
      target: { value: String(Number(scrubber.getAttribute("min")) + 7 * 3600 + 30) },
    });
    await person.click(await screen.findByRole("button", { name: "Play" }));
    const map = await screen.findByRole("img", { name: /^Map/ });
    await waitFor(() => expect(map.getAttribute("data-follow")).not.toBe(""));
    await waitFor(() => expect(Number(map.getAttribute("data-dimmed"))).toBeGreaterThan(0));
    // A second of playback: the tracks are handed over as new data a few times, not at every tick.
    const before = Number(map.getAttribute("data-track-updates"));
    await new Promise((done) => setTimeout(done, 1000));
    expect(Number(map.getAttribute("data-track-updates")) - before).toBeLessThanOrEqual(5);
  });
});
