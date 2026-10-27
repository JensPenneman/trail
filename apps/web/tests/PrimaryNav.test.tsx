import { screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { appRoutes } from "../src/app/createAppRouter";
import { PrimaryNav } from "../src/app/PrimaryNav";
import { renderPage } from "./support/renderPage";

const nav = () => screen.getByRole("navigation", { name: "Main" });
const current = () =>
  within(nav())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);

describe("the main navigation", () => {
  it("offers Map, People, Devices and Settings, and says which one is current", () => {
    renderPage(<PrimaryNav />, { path: "/", url: "/?view=history&date=2026-09-01" });
    expect(
      within(nav())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Map", "People", "Devices", "Settings"]);
    expect(current()).toEqual(["Map"]);
    expect(within(nav()).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings/profile",
    );
  });

  it("keeps an item current on every address below it", () => {
    renderPage(<PrimaryNav />, { path: "/devices/:deviceId", url: "/devices/abc" });
    expect(current()).toEqual(["Devices"]);
  });

  it("marks Settings on each of its sections", () => {
    renderPage(<PrimaryNav />, { path: "/settings/tokens" });
    expect(current()).toEqual(["Settings"]);
  });
});

describe("the old addresses of History and Explore", () => {
  it("open the Map page's views with their parameters", async () => {
    const router = createMemoryRouter(appRoutes(), {
      initialEntries: ["/history?date=2026-09-01&devices=a"],
    });
    const at = () => `${router.state.location.pathname}${router.state.location.search}`;
    // The Map page's code loads before the router settles there.
    await waitFor(() => expect(at()).toBe("/?view=history&date=2026-09-01&devices=a"), {
      timeout: 10_000,
    });
    await router.navigate("/explore");
    await waitFor(() => expect(at()).toBe("/?view=heat"));
    // Replaced, not added: Back leaves the Map page instead of bouncing off the old address.
    expect(router.state.historyAction).toBe("REPLACE");
    router.dispose();
  });
});
