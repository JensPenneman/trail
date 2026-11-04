import { screen, waitFor, within } from "@testing-library/react";
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
});
