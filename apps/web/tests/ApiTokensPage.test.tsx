import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mcpGuideUrl } from "../src/pages/settings/mcpGuide";
import { apiToken, ids } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderSettings } from "./support/renderSettings";
import { standardRoutes } from "./support/standardRoutes";

const secret = "trlk_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";

/** Settings › API tokens, or a token's page, with the standard answers and `routes` on top. */
function renderTokens(url: string, routes: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({ ...standardRoutes(), ...routes });
  const view = renderSettings(url);
  return { ...api, ...view };
}

const heading = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("Settings › API tokens", () => {
  it("lists active tokens apart from revoked and expired ones, a page each", async () => {
    renderTokens("/settings/tokens");
    const active = await screen.findByRole("list", { name: "Active tokens" });
    const token = within(active).getByRole("link", { name: "Home Assistant" });
    expect(token).toHaveAttribute("href", `/settings/tokens/${ids.token}`);
    expect(token).toHaveAccessibleDescription(/^trlk_…x7Kq · iPhone 16 · Expires /);
    const inactive = screen.getByRole("list", { name: "Expired and revoked" });
    const old = within(inactive).getByRole("link", { name: "Old script" });
    expect(old).toHaveAccessibleDescription(/^trlk_…Pq3z · All devices · Revoked .* Revoked$/);
    expect(screen.getByText(/Kept for 30 days after they stop working/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API reference" })).toHaveAttribute("href", "/docs");
    const guide = screen.getByRole("link", { name: "MCP guide" });
    expect(guide).toHaveAttribute("href", mcpGuideUrl);
    expect(guide).toHaveAttribute("rel", "noreferrer");
  });

  it("shows what a token may do, where and until when, on its page", async () => {
    renderTokens(`/settings/tokens/${ids.token}`);
    expect(await heading("Home Assistant")).toBeInTheDocument();
    const facts = Object.fromEntries(
      screen
        .getAllByRole("term")
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(facts).toMatchObject({
      Status: "Active",
      Secret: "trlk_…x7Kq",
      Permissions: "A selection of your own",
      Devices: "iPhone 16",
      Addresses: "Any",
      Lifetime: expect.stringMatching(/^Expires /),
      Use: expect.stringMatching(/^Last used .* from 192\.168\.1\.20$/),
    });
    const scopes = screen.getByRole("list", { name: "Scopes" });
    expect(
      within(scopes)
        .getAllByRole("listitem")
        .map((item) => item.firstChild?.textContent),
    ).toEqual([expect.stringContaining("devices:read"), expect.stringContaining("locations:read")]);
    expect(screen.getByRole("button", { name: "Roll token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke token" })).toBeInTheDocument();
  });

  it("offers neither rolling nor revoking for a token that stopped working", async () => {
    renderTokens(`/settings/tokens/${ids.oldToken}`);
    expect(await heading("Old script")).toBeInTheDocument();
    expect(screen.getByText("Revoked", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Roll token" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke token" })).not.toBeInTheDocument();
  });

  it("points the Agent template to the MCP guide", async () => {
    renderTokens("/settings/tokens");
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Create token" }));
    const dialog = screen.getByRole("dialog", { name: "Create an API token" });
    const agent = within(dialog).getByRole("radio", { name: "Agent" });
    expect(agent).toHaveAccessibleDescription(/connected to Trail's MCP server/);
    expect(within(dialog).getByRole("link", { name: "MCP server" })).toHaveAttribute(
      "href",
      mcpGuideUrl,
    );
  });

  it("fills in the scopes from a template, and leaves the templates for a selection of one's own", async () => {
    renderTokens("/settings/tokens");
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Create token" }));
    const dialog = screen.getByRole("dialog", { name: "Create an API token" });
    expect(within(dialog).getByRole("radio", { name: "Read-only" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "locations:write" })).not.toBeChecked();
    await person.click(within(dialog).getByRole("radio", { name: "Agent" }));
    expect(within(dialog).getByRole("checkbox", { name: "locations:write" })).toBeChecked();
    await person.click(within(dialog).getByRole("checkbox", { name: "people:read" }));
    for (const radio of within(dialog).getAllByRole("radio", {
      name: /^(Read-only|Agent|Full access)$/,
    })) {
      expect(radio).not.toBeChecked();
    }
    await person.click(within(dialog).getByRole("checkbox", { name: "people:read" }));
    expect(within(dialog).getByRole("radio", { name: "Agent" })).toBeChecked();
  });

  it("creates a token and shows its secret once", async () => {
    const created = apiToken({ id: ids.token, name: "Calendar agent", hint: "NpQrS".slice(-4) });
    const { calls } = renderTokens("/settings/tokens", {
      "POST /api/me/tokens": { status: 201, body: { token: created, secret } },
    });
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Create token" }));
    const dialog = screen.getByRole("dialog", { name: "Create an API token" });
    await person.type(within(dialog).getByLabelText("Name"), "Calendar agent");
    await person.click(within(dialog).getByRole("radio", { name: "Agent" }));
    await person.click(within(dialog).getByRole("radio", { name: "Only some devices" }));
    await person.click(within(dialog).getByRole("checkbox", { name: "Car" }));
    await person.click(within(dialog).getByRole("button", { name: "Create token" }));

    const shown = await screen.findByRole("dialog", { name: "Copy the token “Calendar agent”" });
    expect(within(shown).getByLabelText("API token")).toHaveValue(secret);
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({
      name: "Calendar agent",
      scopes: [
        "profile:read",
        "devices:read",
        "locations:read",
        "locations:write",
        "history:read",
        "people:read",
        "shares:read",
      ],
      deviceIds: [ids.car],
      allowedIps: null,
    });
    const { expiresAt: sent } = (post?.body ?? {}) as { expiresAt?: string };
    expect(Math.abs(Date.parse(sent ?? "") - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);

    // The secret stays until it is acknowledged: Escape does not close it.
    await person.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: /Copy the token/ })).toBeInTheDocument();
    await person.click(within(shown).getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
  });

  it("shows a token that expired while the page was open as expired", async () => {
    renderTokens("/settings/tokens", {
      "GET /api/me/tokens": {
        status: 200,
        body: { tokens: [apiToken({ expiresAt: new Date(Date.now() - 1000).toISOString() })] },
      },
    });
    const inactive = await screen.findByRole("list", { name: "Expired and revoked" });
    expect(
      within(inactive).getByRole("link", { name: "Home Assistant" }),
    ).toHaveAccessibleDescription(/Expired$/);
    expect(screen.getByText("No active tokens.")).toBeInTheDocument();
  });

  it("checks the form before sending it", async () => {
    const { calls } = renderTokens("/settings/tokens");
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Create token" }));
    const dialog = screen.getByRole("dialog", { name: "Create an API token" });
    await person.click(within(dialog).getByRole("checkbox", { name: "profile:read" }));
    for (const scope of [
      "devices:read",
      "locations:read",
      "history:read",
      "people:read",
      "shares:read",
      "audit:read",
    ]) {
      await person.click(within(dialog).getByRole("checkbox", { name: scope }));
    }
    await person.click(within(dialog).getByRole("radio", { name: "Only some devices" }));
    await person.selectOptions(within(dialog).getByLabelText("Expires"), "never");
    expect(within(dialog).getByText("A token without an expiry")).toBeInTheDocument();
    await person.click(within(dialog).getByText("Limit to IP addresses (optional)"));
    await person.type(within(dialog).getByLabelText("Allowed addresses"), "192.168.1.7/24");
    await person.click(within(dialog).getByRole("button", { name: "Create token" }));

    expect(within(dialog).getByText("Use 1 to 60 characters.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose at least one permission.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Pick at least one device, or allow them all."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/the network is 192\.168\.1\.0\/24/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("shows the API's reason when the token was refused", async () => {
    renderTokens("/settings/tokens", {
      "POST /api/me/tokens": {
        status: 409,
        body: { error: { code: "conflict", message: "You have 50 active API tokens." } },
      },
    });
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Create token" }));
    const dialog = screen.getByRole("dialog", { name: "Create an API token" });
    await person.type(within(dialog).getByLabelText("Name"), "One too many");
    await person.click(within(dialog).getByRole("button", { name: "Create token" }));
    expect(await within(dialog).findByText("You have 50 active API tokens.")).toBeInTheDocument();
  });

  it("rolls a token after a confirmation and shows the new secret", async () => {
    const { calls } = renderTokens(`/settings/tokens/${ids.token}`, {
      [`POST /api/me/tokens/${ids.token}/roll`]: {
        status: 200,
        body: { token: apiToken({ hint: "QrS9" }), secret },
      },
    });
    const person = userEvent.setup();
    await heading("Home Assistant");
    await person.click(screen.getByRole("button", { name: "Roll token" }));
    const confirm = screen.getByRole("dialog", { name: "Roll “Home Assistant”?" });
    expect(within(confirm).getByText(/stops working immediately/)).toBeInTheDocument();
    await person.click(within(confirm).getByRole("button", { name: "Roll token" }));
    const shown = await screen.findByRole("dialog", {
      name: "Copy the new secret of “Home Assistant”",
    });
    expect(within(shown).getByLabelText("API token")).toHaveValue(secret);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    await person.click(within(shown).getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("revokes a token after a confirmation, and its page says so", async () => {
    let revoked = false;
    const { calls } = renderTokens(`/settings/tokens/${ids.token}`, {
      "GET /api/me/tokens": () => ({
        status: 200,
        body: {
          tokens: [
            revoked
              ? apiToken({ status: "revoked", revokedAt: new Date().toISOString() })
              : apiToken(),
          ],
        },
      }),
      [`DELETE /api/me/tokens/${ids.token}`]: () => {
        revoked = true;
        return { status: 204 };
      },
    });
    const person = userEvent.setup();
    await heading("Home Assistant");
    await person.click(screen.getByRole("button", { name: "Revoke token" }));
    const confirm = screen.getByRole("dialog", { name: "Revoke “Home Assistant”?" });
    await person.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await person.click(screen.getByRole("button", { name: "Revoke token" }));
    await person.click(
      within(screen.getByRole("dialog", { name: "Revoke “Home Assistant”?" })).getByRole("button", {
        name: "Revoke token",
      }),
    );
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([
      `/api/me/tokens/${ids.token}`,
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Revoked", { selector: "dd" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Revoke token" })).not.toBeInTheDocument(),
    );
  });

  it("says when the account has as many active tokens as it may", async () => {
    renderTokens("/settings/tokens", {
      "GET /api/me/tokens": {
        status: 200,
        body: {
          tokens: Array.from({ length: 50 }, (_, index) =>
            apiToken({ id: `01926f3e-4a71-7c93-a465-${String(index).padStart(12, "0")}` }),
          ),
        },
      },
    });
    expect(await screen.findByText("50 active tokens")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
  });
});

describe("Settings › MCP", () => {
  it("says how to connect, and makes an Agent token in one step", async () => {
    renderTokens("/settings/mcp");
    expect(await heading("MCP")).toBeInTheDocument();
    expect(screen.getByLabelText("Server address")).toHaveValue(`${window.location.origin}/mcp`);
    expect(screen.getByText("Authorization: Bearer trlk_…")).toBeInTheDocument();
    const guide = screen.getByRole("link", { name: "MCP guide (opens in a new tab)" });
    expect(guide).toHaveAttribute("href", mcpGuideUrl);
    expect(guide).toHaveAttribute("target", "_blank");
    const person = userEvent.setup();
    await person.click(screen.getByRole("button", { name: "Create an Agent token" }));
    const dialog = screen.getByRole("dialog", { name: "Create an API token" });
    expect(within(dialog).getByRole("radio", { name: "Agent" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "locations:write" })).toBeChecked();
  });
});
