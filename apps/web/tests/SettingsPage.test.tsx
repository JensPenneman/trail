import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderSettings } from "./support/renderSettings";
import { standardRoutes } from "./support/standardRoutes";

const nav = () => screen.getByRole("navigation", { name: "Settings" });
const row = (name: string) => within(nav()).getByRole("link", { name });
const heading = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("Settings on a phone", () => {
  it("is a list of groups with search, each row with its value", async () => {
    mockApi(standardRoutes());
    renderSettings("/settings");
    expect(await heading("Settings")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Settings" })).toBeInTheDocument();
    expect(
      within(nav())
        .getAllByRole("heading", { level: 2 })
        .map((group) => group.textContent),
    ).toEqual(["Account", "Privacy & data", "Developer", "App", "Admin"]);
    expect(
      within(screen.getByRole("list", { name: "Account" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      expect.stringContaining("Profile"),
      expect.stringContaining("Passkeys"),
      expect.stringContaining("Browsers"),
    ]);
    expect(row("Profile")).toHaveAttribute("href", "/settings/profile");
    expect(row("Profile")).toHaveAccessibleDescription("Jens");
    await waitFor(() => expect(row("Passkeys")).toHaveAccessibleDescription("1"));
    await waitFor(() => expect(row("Browsers")).toHaveAccessibleDescription("2"));
    await waitFor(() => expect(row("Sharing")).toHaveAccessibleDescription("1"));
    await waitFor(() => expect(row("Public links")).toHaveAccessibleDescription("1 active"));
    await waitFor(() => expect(row("API tokens")).toHaveAccessibleDescription("1"));
    await waitFor(() => expect(row("Notifications")).toHaveAccessibleDescription("On"));
    await waitFor(() => expect(row("About")).toHaveAccessibleDescription("0.1.0"));
    expect(row("Who viewed you")).toHaveAttribute("href", "/settings/privacy/viewers");
    expect(row("Access log")).toHaveAttribute("href", "/settings/privacy/access-log");
    expect(row("API reference")).toHaveAttribute("href", "/docs");
    expect(row("Accounts")).toHaveAttribute("href", "/settings/accounts");
    expect(document.title).toBe("Settings · Trail");
  });

  it("keeps the administrators' rows and page from everyone else", async () => {
    mockApi(standardRoutes());
    const visitor = { ...user, isAdmin: false };
    const { router } = renderSettings("/settings/accounts", { user: visitor });
    expect(await heading("Settings")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings");
    expect(within(nav()).queryByRole("link", { name: "Accounts" })).not.toBeInTheDocument();
    expect(within(nav()).queryByRole("heading", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("finds pages and parts of them, and opens the first match with Enter", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings("/settings");
    const search = await screen.findByRole("searchbox", { name: "Search Settings" });
    await person.type(search, "zzz");
    expect(screen.getByText("No settings match “zzz”.")).toBeInTheDocument();
    expect(screen.getByText("No results")).toHaveAttribute("role", "status");
    await person.clear(search);
    await person.type(search, "gpx");
    const results = screen.getByRole("list", { name: "Results" });
    expect(within(results).getByRole("link", { name: "Your data" })).toHaveAccessibleDescription(
      "Privacy & data",
    );
    expect(within(results).getByRole("link", { name: "Export" })).toHaveAccessibleDescription(
      "Privacy & data › Your data",
    );
    expect(screen.queryByRole("navigation", { name: "Settings" })).not.toBeInTheDocument();
    await person.clear(search);
    await person.type(search, "export{Enter}");
    expect(await heading("Your data")).toBeInTheDocument();
    expect(router.state.location).toMatchObject({ pathname: "/settings/data", hash: "#export" });
    // Focus goes to the part the address names.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Export" })).toHaveFocus(),
    );
  });

  it("goes a page deeper and comes back, with focus on the row it came from", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings("/settings");
    await person.click(await screen.findByRole("link", { name: "Passkeys" }));
    expect(await heading("Passkeys")).toHaveFocus();
    expect(document.title).toBe("Passkeys · Settings · Trail");
    await person.click(await screen.findByRole("link", { name: "iCloud Keychain" }));
    expect(await heading("iCloud Keychain")).toHaveFocus();
    expect(router.state.location.pathname).toBe("/settings/passkeys/pk-1");
    expect(document.title).toBe("iCloud Keychain · Passkeys · Settings · Trail");

    await person.click(screen.getByRole("link", { name: "Back to Passkeys" }));
    expect(await heading("Passkeys")).toBeInTheDocument();
    // Back in the history, as the browser's Back button would: no new entry.
    expect(router.state.historyAction).toBe("POP");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "iCloud Keychain" })).toHaveFocus(),
    );
    await person.click(screen.getByRole("link", { name: "Back to Settings" }));
    expect(await heading("Settings")).toBeInTheDocument();
    expect(router.state.historyAction).toBe("POP");
    await waitFor(() => expect(row("Passkeys")).toHaveFocus());
  });

  it("goes up to the page above when opened by its address", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings(`/settings/tokens/${ids.token}`);
    expect(await heading("Home Assistant")).toBeInTheDocument();
    await person.click(screen.getByRole("link", { name: "Back to API tokens" }));
    expect(await heading("API tokens")).toBeInTheDocument();
    expect(router.state.historyAction).toBe("PUSH");
  });

  it("opens the page of an anchor of the single Settings page of old", async () => {
    mockApi(standardRoutes());
    const { router } = renderSettings("/settings#browsers");
    expect(await heading("Browsers")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/browsers");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Signed-in browsers" }),
    ).toHaveAttribute("id", "browsers");
  });

  it("sends the accounts' old address to the new one", async () => {
    mockApi(standardRoutes());
    const { router } = renderSettings("/settings/people#invite");
    expect(await heading("Accounts")).toBeInTheDocument();
    expect(router.state.location).toMatchObject({
      pathname: "/settings/accounts",
      hash: "#invite",
    });
    expect(screen.getByText("Invite someone")).toBeInTheDocument();
  });

  it("leaves unknown addresses to the 404 page, and says when an item is gone", async () => {
    mockApi(standardRoutes());
    renderSettings("/settings/elsewhere");
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
  });

  it("says when the item of a page does not exist", async () => {
    mockApi(standardRoutes());
    renderSettings("/settings/tokens/01926f3e-0000-7000-8000-000000000000");
    expect(await heading("API token not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API tokens" })).toHaveAttribute(
      "href",
      "/settings/tokens",
    );
  });
});

describe("Settings beside the list", () => {
  it("opens the first page, and marks the page on screen in the list", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings("/settings", { wide: true });
    expect(await heading("Profile")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/profile");
    expect(screen.getByLabelText("Display name")).toHaveValue("Jens");
    expect(row("Profile")).toHaveAttribute("aria-current", "page");
    expect(document.title).toBe("Profile · Settings · Trail");

    await person.click(row("API tokens"));
    expect(await heading("API tokens")).toHaveFocus();
    expect(row("API tokens")).toHaveAttribute("aria-current", "page");
    expect(row("Profile")).not.toHaveAttribute("aria-current");

    // The page of one item keeps its page's row marked.
    await person.click(await screen.findByRole("link", { name: "Home Assistant" }));
    expect(await heading("Home Assistant")).toBeInTheDocument();
    expect(row("API tokens")).toHaveAttribute("aria-current", "page");
  });

  it("searches from the sidebar and keeps the query while pages change", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderSettings("/settings/profile", { wide: true });
    const search = await screen.findByRole("searchbox", { name: "Search Settings" });
    await person.type(search, "ntfy");
    await person.click(screen.getByRole("link", { name: "Notifications" }));
    expect(await heading("Notifications")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search Settings" })).toHaveValue("ntfy");
  });
});
