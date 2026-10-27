import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { car, config, device, ids } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderSettings } from "./support/renderSettings";
import { standardRoutes } from "./support/standardRoutes";

const heading = (name: string) => screen.findByRole("heading", { level: 1, name });

const passkey = (id: string, name: string) => ({
  id,
  name,
  rpId: "localhost",
  usableHere: true,
  provider: "iCloud Keychain",
  backedUp: true,
  deviceType: "multiDevice",
  transports: ["internal"],
  createdAt: "2026-03-02T19:20:11.000Z",
  lastUsedAt: null,
});

describe("Settings › Passkeys", () => {
  it("lists the passkeys, a page each to rename or delete one", async () => {
    let list = [passkey("pk-1", "iCloud Keychain"), passkey("pk-2", "Security key")];
    const api = mockApi({
      ...standardRoutes(),
      "GET /api/me/passkeys": () => ({ status: 200, body: { passkeys: list } }),
      "PATCH /api/me/passkeys/pk-2": ({ body }) => {
        const { name } = body as { name: string };
        list = list.map((key) => (key.id === "pk-2" ? { ...key, name } : key));
        return { status: 200, body: { ok: true } };
      },
      "DELETE /api/me/passkeys/pk-2": () => {
        list = list.filter((key) => key.id !== "pk-2");
        return { status: 200, body: { ok: true } };
      },
    });
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/passkeys");
    const passkeys = await screen.findByRole("list", { name: "Your passkeys" });
    expect(
      within(passkeys).getByRole("link", { name: "iCloud Keychain" }),
    ).toHaveAccessibleDescription("iCloud Keychain · synced · works on this address");
    expect(
      within(passkeys).getByRole("button", { name: "Add a passkey here" }),
    ).toBeInTheDocument();

    await person.click(within(passkeys).getByRole("link", { name: "Security key" }));
    expect(await heading("Security key")).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Rename" }));
    const rename = screen.getByRole("dialog", { name: "Rename passkey" });
    expect(within(rename).getByLabelText("Name")).toHaveValue("Security key");
    await person.clear(within(rename).getByLabelText("Name"));
    await person.type(within(rename).getByLabelText("Name"), "YubiKey");
    await person.click(within(rename).getByRole("button", { name: "Save" }));
    expect(await heading("YubiKey")).toBeInTheDocument();

    await person.click(screen.getByRole("button", { name: "Delete passkey" }));
    const remove = screen.getByRole("dialog", { name: "Delete “YubiKey”?" });
    await person.click(within(remove).getByRole("button", { name: "Delete passkey" }));
    expect(await heading("Passkeys")).toBeInTheDocument();
    expect(router.state.historyAction).toBe("POP");
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "YubiKey" })).not.toBeInTheDocument(),
    );
    expect(api.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("keeps the last passkey, and says why", async () => {
    mockApi({
      ...standardRoutes(),
      "DELETE /api/me/passkeys/pk-1": {
        status: 409,
        body: { error: { code: "last_passkey", message: "This is your only passkey." } },
      },
    });
    const person = userEvent.setup();
    renderSettings("/settings/passkeys/pk-1");
    expect(await heading("iCloud Keychain")).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Delete passkey" }));
    const remove = screen.getByRole("dialog", { name: "Delete “iCloud Keychain”?" });
    await person.click(within(remove).getByRole("button", { name: "Delete passkey" }));
    expect(await within(remove).findByRole("alert")).toHaveTextContent("This is your only passkey");
    await person.click(within(remove).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { level: 1, name: "iCloud Keychain" })).toBeInTheDocument();
  });
});

describe("Settings › Browsers", () => {
  it("lists the signed-in browsers and signs out any but this one", async () => {
    const api = mockApi({ ...standardRoutes(), "DELETE /api/me/sessions/s2": { status: 204 } });
    const person = userEvent.setup();
    renderSettings("/settings/browsers");
    const browsers = await screen.findByRole("list", { name: "Signed-in browsers" });
    expect(within(browsers).getAllByRole("listitem")).toHaveLength(2);
    expect(within(browsers).getByText("This browser")).toBeInTheDocument();
    expect(
      within(browsers).queryByRole("button", { name: "Sign out Firefox on Mac" }),
    ).not.toBeInTheDocument();
    await person.click(within(browsers).getByRole("button", { name: "Sign out Safari on iPhone" }));
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === "DELETE" && call.path === "/api/me/sessions/s2"),
      ).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Sign out everywhere else" })).toBeInTheDocument();
  });
});

describe("Settings › Notifications", () => {
  it("switches each device's alert at once", async () => {
    const switched = !car().alertsEnabled;
    const api = mockApi({
      ...standardRoutes(),
      [`PATCH /api/devices/${ids.car}`]: {
        status: 200,
        body: { device: { ...car(), alertsEnabled: switched } },
      },
    });
    renderSettings("/settings/notifications");
    const alerts = await screen.findByRole("list", { name: "Device alerts" });
    const phone = within(alerts).getByRole("switch", { name: "iPhone 16" });
    expect(phone).toBeChecked();
    const carSwitch = within(alerts).getByRole("switch", { name: "Car" });
    // In the same turn as the click, not only once the answer is in.
    fireEvent.click(carSwitch);
    expect((carSwitch as HTMLInputElement).checked).toBe(switched);
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({
        alertsEnabled: switched,
      }),
    );
    expect(
      await screen.findByText(`Alerts for Car ${switched ? "on" : "off"}.`),
    ).toBeInTheDocument();
    expect((within(alerts).getByRole("switch", { name: "Car" }) as HTMLInputElement).checked).toBe(
      switched,
    );
    expect(screen.getByText("Sent through ntfy")).toBeInTheDocument();
  });

  it("says when the server sends no alerts, and offers no switch", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/config": { status: 200, body: { ...config, features: { alerts: false } } },
      "GET /api/devices": { status: 200, body: { devices: [device()] } },
    });
    renderSettings("/settings/notifications");
    expect(await screen.findByText("No alerts are sent")).toBeInTheDocument();
    expect(screen.getByText("Not set up")).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "iPhone 16" })).toBeDisabled();
  });
});
