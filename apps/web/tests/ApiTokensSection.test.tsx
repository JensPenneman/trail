import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiTokensSection } from "../src/pages/settings/ApiTokensSection";
import { apiToken, ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

const secret = "trlk_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";

function renderSection(routes: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({ ...standardRoutes(), ...routes });
  const view = renderPage(<ApiTokensSection headingId="tokens" />, { path: "/settings", user });
  return { ...api, ...view };
}

describe("ApiTokensSection", () => {
  it("lists active tokens apart from revoked and expired ones", async () => {
    renderSection();
    const active = await screen.findByRole("list", { name: "Active tokens" });
    const item = within(active).getAllByRole("listitem")[0];
    if (item === undefined) throw new Error("no token listed");
    expect(within(item).getByText("Home Assistant")).toBeInTheDocument();
    expect(within(item).getByText("Active")).toBeInTheDocument();
    expect(within(item).getByText("trlk_…x7Kq")).toBeInTheDocument();
    expect(within(item).getByText(/iPhone 16 from any address/)).toBeInTheDocument();
    expect(
      within(within(item).getByRole("list", { name: "Scopes of Home Assistant" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
    expect(within(item).getByText(/last used .* from 192\.168\.1\.20/)).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "Roll Home Assistant" })).toBeInTheDocument();

    const inactive = screen.getByRole("heading", { name: "Expired and revoked" });
    expect(inactive).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText(/All devices from 203\.0\.113\.0\/24/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Roll Old script" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API reference" })).toHaveAttribute("href", "/docs");
  });

  it("fills in the scopes from a template, and leaves the templates for a selection of one's own", async () => {
    renderSection();
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
    const { calls } = renderSection({
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
    renderSection({
      "GET /api/me/tokens": {
        status: 200,
        body: { tokens: [apiToken({ expiresAt: new Date(Date.now() - 1000).toISOString() })] },
      },
    });
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Roll Home Assistant" })).not.toBeInTheDocument();
    expect(screen.getByText("No active tokens.")).toBeInTheDocument();
  });

  it("checks the form before sending it", async () => {
    const { calls } = renderSection();
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
    renderSection({
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
    const { calls } = renderSection({
      [`POST /api/me/tokens/${ids.token}/roll`]: {
        status: 200,
        body: { token: apiToken({ hint: "QrS9" }), secret },
      },
    });
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Roll Home Assistant" }));
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

  it("revokes a token after a confirmation", async () => {
    const { calls } = renderSection({
      [`DELETE /api/me/tokens/${ids.token}`]: { status: 204 },
    });
    const person = userEvent.setup();
    await person.click(await screen.findByRole("button", { name: "Revoke Home Assistant" }));
    const confirm = screen.getByRole("dialog", { name: "Revoke “Home Assistant”?" });
    await person.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await person.click(screen.getByRole("button", { name: "Revoke Home Assistant" }));
    await person.click(
      within(screen.getByRole("dialog", { name: "Revoke “Home Assistant”?" })).getByRole("button", {
        name: "Revoke token",
      }),
    );
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([
      `/api/me/tokens/${ids.token}`,
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when the account has as many active tokens as it may", async () => {
    renderSection({
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
