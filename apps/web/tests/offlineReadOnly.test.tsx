import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

afterEach(() => {
  window.localStorage.clear();
});

describe("the People page offline", () => {
  it("turns off what would change something, each with the reason, and keeps the rest", async () => {
    mockApi(standardRoutes());
    const onLine = vi.spyOn(navigator, "onLine", "get");
    renderPage(<PeoplePage />, { user });
    const me = screen.getByRole("region", { name: "Me" });
    const chips = await within(me).findByRole("group", { name: "Now:" });
    expect(within(chips).getByRole("button", { name: "Auto", pressed: true })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Share my location" })).toBeEnabled();

    onLine.mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    expect(
      await within(chips).findByRole("button", { name: "Auto", pressed: true }),
    ).toBeDisabled();
    expect(chips).toHaveAccessibleDescription(
      /You’re offline: how you travel can be set once you reconnect\./,
    );
    const share = screen.getByRole("button", { name: "Share my location" });
    expect(share).toBeDisabled();
    expect(share).toHaveAccessibleDescription(
      "You’re offline: whom you share with can be changed once you reconnect.",
    );
    // Looking around still works.
    expect(within(me).getByRole("button", { name: "Show on map" })).toBeEnabled();

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByRole("button", { name: "Share my location" })).toBeEnabled();
  });
});
