import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "../src/pages/settings/SettingsPage";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

describe("SettingsPage", () => {
  it("shows profile, passkeys, browsers, people (for admins), data and build info", async () => {
    mockApi(standardRoutes());
    renderPage(<SettingsPage />, { path: "/settings", user });
    expect(screen.getByLabelText("Display name")).toHaveValue("Jens");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Brussels");
    expect(await screen.findByText("iCloud Keychain")).toBeInTheDocument();
    expect(screen.getByText(/works on this address/)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Sign out Safari on iPhone" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/export?"),
    );
    expect(await screen.findByText("3f9c2a1")).toBeInTheDocument();
  });

  it("hides the people section from other accounts", async () => {
    mockApi(standardRoutes());
    renderPage(<SettingsPage />, { path: "/settings", user: { ...user, isAdmin: false } });
    expect(await screen.findByText("iCloud Keychain")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "People" })).not.toBeInTheDocument();
  });
});
