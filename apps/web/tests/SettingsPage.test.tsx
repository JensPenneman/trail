import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { settingsSections } from "../src/app/settingsSections";
import { SettingsIndex } from "../src/pages/settings/SettingsIndex";
import { SettingsLayout } from "../src/pages/settings/SettingsLayout";
import { SettingsSection } from "../src/pages/settings/SettingsSection";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

/** Settings as the app routes it: the layout, `/settings` and a route per section. */
const routes: RouteObject[] = [
  {
    path: "/settings",
    element: <SettingsLayout />,
    children: [
      { index: true, element: <SettingsIndex /> },
      ...settingsSections.map((section) => ({
        path: section.id,
        element: <SettingsSection id={section.id} />,
      })),
    ],
  },
  { path: "*", element: <p>Elsewhere</p> },
];

const sections = () => screen.getByRole("navigation", { name: "Settings sections" });

describe("Settings", () => {
  it("opens Profile at /settings, and names the current section", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(null, { routes, url: "/settings", user });
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/profile"));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Jens");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Brussels");
    expect(within(sections()).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(sections()).getByRole("link", { name: "API tokens" })).not.toHaveAttribute(
      "aria-current",
    );
    await waitFor(() => expect(document.title).toBe("Profile · Settings · Trail"));
  });

  it("has a section at an address of its own for each part", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(null, { routes, url: "/settings/profile", user });
    await person.click(within(sections()).getByRole("link", { name: "Passkeys" }));
    expect(router.state.location.pathname).toBe("/settings/passkeys");
    expect(await screen.findByText("iCloud Keychain")).toBeInTheDocument();
    expect(screen.getByText(/works on this address/)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Sign out Safari on iPhone" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Signed-in browsers" })).toHaveAttribute(
      "id",
      "browsers",
    );

    await person.click(within(sections()).getByRole("link", { name: "API tokens" }));
    expect(router.state.location.pathname).toBe("/settings/tokens");
    expect(await screen.findByText("Home Assistant")).toBeInTheDocument();

    await person.click(within(sections()).getByRole("link", { name: "Data" }));
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/export?"),
    );

    await person.click(within(sections()).getByRole("link", { name: "About" }));
    expect(await screen.findByText("3f9c2a1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("opens the section of an old anchor", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(null, { routes, url: "/settings#browsers", user });
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/passkeys"));
    expect(router.state.location.hash).toBe("#browsers");
  });

  it("shows the accounts of the server to administrators only", async () => {
    mockApi(standardRoutes());
    renderPage(null, { routes, url: "/settings/people", user });
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByText("Invite someone")).toBeInTheDocument();
    expect(within(sections()).getByRole("link", { name: "Accounts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("sends everyone else from the accounts to Profile", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(null, {
      routes,
      url: "/settings/people",
      user: { ...user, isAdmin: false },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/profile"));
    expect(within(sections()).queryByRole("link", { name: "Accounts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Accounts" })).not.toBeInTheDocument();
  });
});
