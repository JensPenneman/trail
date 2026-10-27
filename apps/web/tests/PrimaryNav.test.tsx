import { screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { appRoutes } from "../src/app/createAppRouter";
import { PrimaryNav } from "../src/app/PrimaryNav";
import { ids } from "./support/fixtures";
import { renderPage } from "./support/renderPage";

const nav = () => screen.getByRole("navigation", { name: "Main" });
const current = () =>
  within(nav())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);

describe("the main navigation", () => {
  it("offers People, Devices and Settings, and says which one is current", () => {
    renderPage(<PrimaryNav />, { path: "/", url: "/?view=history&date=2026-09-01" });
    expect(
      within(nav())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["People", "Devices", "Settings"]);
    expect(current()).toEqual(["People"]);
    expect(within(nav()).getByRole("link", { name: "People" })).toHaveAttribute("href", "/");
    expect(within(nav()).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("keeps an item current on every address below it", () => {
    renderPage(<PrimaryNav />, { path: "/devices/:deviceId", url: "/devices/abc" });
    expect(current()).toEqual(["Devices"]);
  });

  it("marks Settings on each of its pages", () => {
    renderPage(<PrimaryNav />, { path: "/settings/tokens/:tokenId", url: "/settings/tokens/abc" });
    expect(current()).toEqual(["Settings"]);
  });
});

// The People page's code loads through the app's own routes: slow on a busy machine.
const loadingThePage = 15_000;

describe("the old addresses of History, Explore and People", {
  timeout: 2 * loadingThePage,
}, () => {
  it("open the People page's views with their parameters", async () => {
    const router = createMemoryRouter(appRoutes(), {
      initialEntries: ["/history?date=2026-09-01&devices=a"],
    });
    const at = () => `${router.state.location.pathname}${router.state.location.search}`;
    // The People page's code loads before the router settles there.
    await waitFor(() => expect(at()).toBe("/?view=history&date=2026-09-01&devices=a"), {
      timeout: loadingThePage,
    });
    await router.navigate("/explore");
    await waitFor(() => expect(at()).toBe("/?view=heat"));
    // Replaced, not added: Back leaves the People page instead of bouncing off the old address.
    expect(router.state.historyAction).toBe("REPLACE");
    router.dispose();
  });

  it("lead from /people to the home page, every parameter kept", async () => {
    const router = createMemoryRouter(appRoutes(), {
      initialEntries: [`/people?view=history&date=2026-09-01&people=me,${ids.ana}`],
    });
    const at = () => `${router.state.location.pathname}${router.state.location.search}`;
    const expected = `/?view=history&date=2026-09-01&people=me,${ids.ana}`;
    await waitFor(() => expect(at()).toBe(expected), { timeout: loadingThePage });
    expect(router.state.historyAction).toBe("REPLACE");
    await router.navigate("/people");
    await waitFor(() => expect(at()).toBe("/"));
    router.dispose();
  });
});
