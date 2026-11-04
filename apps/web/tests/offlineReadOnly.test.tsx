import { screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByRole("button", { name: "Share my location" })).toBeEnabled();

    onLine.mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    const share = await screen.findByRole("button", { name: "Share my location" });
    await waitFor(() => expect(share).toBeDisabled());
    expect(share).toHaveAccessibleDescription(
      "You’re offline: whom you share with can be changed once you reconnect.",
    );
    // Looking around still works: the rows are links.
    expect(screen.getByRole("link", { name: /^Me/ })).toBeInTheDocument();

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByRole("button", { name: "Share my location" })).toBeEnabled();
  });
});
