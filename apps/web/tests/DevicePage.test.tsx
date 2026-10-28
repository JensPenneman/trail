import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { removeDeviceFromCache } from "../src/devices/removeDeviceFromCache";
import { car, device, ids } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderSettings } from "./support/renderSettings";
import { standardRoutes } from "./support/standardRoutes";

const devicePage = `/settings/devices/${ids.phone}`;
const heading = (name: string) => screen.findByRole("heading", { level: 1, name });
/** The value of a fact of the page (Overview, Connection), by its label. */
const fact = (label: string) =>
  screen.getByText(label, { selector: ".settings-fact__label" }).nextElementSibling as HTMLElement;

describe("Settings › Devices › a device", () => {
  it("shows the device's state, activity, quick toggle and alert, with its parts a level deeper", async () => {
    mockApi(standardRoutes());
    renderSettings(devicePage);
    expect(await heading("iPhone 16")).toBeInTheDocument();
    expect(document.title).toBe("iPhone 16 · Devices · Settings · Trail");
    expect(screen.getByRole("link", { name: "Back to Devices" })).toHaveAttribute(
      "href",
      "/settings/devices",
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Overview" })).toBeInTheDocument();
    expect(fact("Device ID")).toHaveTextContent("iphone-16-k3f9");
    expect(fact("App")).toHaveTextContent("Overland");
    expect(fact("Points")).toHaveTextContent("1,066 today · 1,240 in 24 h · 184,322 in total");
    expect(fact("Access token")).toHaveTextContent("…q7Zx");
    // What the People page's Live view had of it: the hours of activity and the quick toggle.
    expect(
      await screen.findByRole("img", {
        name: /iPhone 16, last 48 hours: 40 points in 1 of 48 hours, 3 uploads\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Now:" })).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Tell me when this device goes silent" }),
    ).toBeChecked();
    // The parts of it, each a page of its own.
    const sent = screen.getByRole("list", { name: "What it sent" });
    expect(within(sent).getByRole("link", { name: "Uploads" })).toHaveAttribute(
      "href",
      `${devicePage}/uploads`,
    );
    expect(within(sent).getByRole("link", { name: "Raw points" })).toHaveAttribute(
      "href",
      `${devicePage}/points`,
    );
    expect(within(sent).getByRole("link", { name: "Raw points" })).toHaveAccessibleDescription(
      "Every stored point, newest first. 184,322",
    );
    expect(within(sent).getByRole("link", { name: "History" })).toHaveAttribute(
      "href",
      `/?view=history&devices=${ids.phone}`,
    );
    const phone = screen.getByRole("list", { name: "The phone" });
    expect(within(phone).getByRole("link", { name: "Tracking settings" })).toHaveAttribute(
      "href",
      `${devicePage}/tracking`,
    );
    expect(within(phone).getByRole("link", { name: "Setup" })).toHaveAttribute(
      "href",
      `${devicePage}/setup`,
    );
    for (const action of ["Rename", "Issue new token", "Delete device"]) {
      expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    }
    // The tables are their pages', not this one's.
    expect(screen.queryByRole("table", { name: "Uploads of this device" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Stored points of this device" })).toBeNull();
  });

  it("leaves Settings for its tracks in History, keeping no way back into Settings", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings(devicePage);
    await person.click(await screen.findByRole("link", { name: "History" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    expect(router.state.location).toMatchObject({
      pathname: "/",
      search: `?view=history&devices=${ids.phone}`,
      state: null,
    });
  });

  it("goes a level deeper to its uploads and comes back, with focus on the row", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings(devicePage);
    await person.click(await screen.findByRole("link", { name: "Uploads" }));
    expect(await heading("Uploads")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${devicePage}/uploads`);
    expect(document.title).toBe("Uploads · iPhone 16 · Devices · Settings · Trail");
    expect(screen.getByText("Requests from the phone, newest first.")).toBeInTheDocument();
    const uploads = await screen.findByRole("table", { name: "Uploads of this device" });
    expect(within(uploads).getAllByRole("row")).toHaveLength(2);
    expect(within(uploads).getByText("Overland/2025.3")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Uploads" })).toHaveFocus(),
    );

    await person.click(screen.getByRole("link", { name: "Back to iPhone 16" }));
    expect(await heading("iPhone 16")).toBeInTheDocument();
    expect(router.state.historyAction).toBe("POP");
    await waitFor(() => expect(screen.getByRole("link", { name: "Uploads" })).toHaveFocus());
  });

  it("lists the raw points on a page of their own, which leads back to the device", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings(`${devicePage}/points`);
    expect(await heading("Raw points")).toBeInTheDocument();
    expect(
      await screen.findByRole("table", { name: "Stored points of this device" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 shown")).toBeInTheDocument();
    // Opened by its address: the way back leads to the device's page.
    await person.click(screen.getByRole("link", { name: "Back to iPhone 16" }));
    expect(await heading("iPhone 16")).toBeInTheDocument();
    expect(router.state.historyAction).toBe("PUSH");
  });

  it("offers Overland's presets on the tracking page", async () => {
    mockApi(standardRoutes());
    renderSettings(`${devicePage}/tracking`);
    expect(await heading("Tracking settings")).toBeInTheDocument();
    expect(
      await screen.findByText("Change how Overland records, without touching the phone."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to iPhone 16" })).toHaveAttribute(
      "href",
      devicePage,
    );
    expect(screen.getByRole("radio", { name: /Battery saver/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send with next upload" })).toBeDisabled();
  });

  it("shows the setup of the device's app", async () => {
    mockApi(standardRoutes());
    renderSettings(`${devicePage}/setup`);
    expect(await heading("Setup")).toBeInTheDocument();
    expect(
      await screen.findByText(/^Overland \(iOS\)\. To set the phone up again/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fact("Receiver endpoint")).toHaveTextContent("https://trail.example.com/api/overland"),
    );
    expect(fact("Access token")).toHaveTextContent("the access token (…q7Zx)");
    expect(
      screen.getByRole("heading", { level: 2, name: "Recommended Overland settings" }),
    ).toBeInTheDocument();
  });

  it("shows another app's setup and no Overland presets", async () => {
    const pixel = device({ source: "owntracks", deviceKey: "pixel-k3f9", name: "Pixel 8" });
    mockApi({
      ...standardRoutes(),
      [`GET /api/devices/${ids.phone}`]: { status: 200, body: { device: pixel } },
    });
    const person = userEvent.setup();
    renderSettings(devicePage);
    expect(await heading("Pixel 8")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tracking settings" })).toBeNull();
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAccessibleDescription(
      "The app, how it is connected, and the settings Trail recommends for it.",
    );

    await person.click(screen.getByRole("link", { name: "Setup" }));
    expect(await heading("Setup")).toBeInTheDocument();
    expect(screen.getByText(/^OwnTracks \(iOS and Android\)/)).toBeInTheDocument();
    expect(fact("URL")).toHaveTextContent("https://trail.example.com/api/owntracks");
    expect(fact("Tracker ID")).toHaveTextContent("P8");
    // On an iPhone the token goes in a header; on Android it is the password.
    expect(fact("HTTP Headers")).toHaveTextContent(/…q7Zx/);
    await person.click(screen.getByRole("radio", { name: "Significant changes" }));
    expect(screen.getByText(/^Significant changes leaves the fixes to iOS/)).toBeInTheDocument();
    await person.click(screen.getByRole("radio", { name: "Android" }));
    expect(screen.getByText("Recommended OwnTracks settings on Android")).toBeInTheDocument();
    expect(fact("Password")).toBeInTheDocument();
    expect(screen.queryByText("HTTP Headers", { selector: ".settings-fact__label" })).toBeNull();
  });

  it("says that only Overland takes tracking settings, at that page's address", async () => {
    const pixel = device({ source: "owntracks", name: "Pixel 8" });
    mockApi({
      ...standardRoutes(),
      [`GET /api/devices/${ids.phone}`]: { status: 200, body: { device: pixel } },
    });
    renderSettings(`${devicePage}/tracking`);
    expect(
      await screen.findByRole("heading", {
        name: "Only Overland takes tracking settings from Trail",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("link", { name: "Pixel 8" })).toHaveAttribute("href", devicePage);
  });

  it("issues a new token for another app and shows that app's setup", async () => {
    const token = "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";
    const moved = device({ source: "gpslogger" });
    const { calls } = mockApi({
      ...standardRoutes(),
      [`POST /api/devices/${ids.phone}/token`]: {
        status: 200,
        body: {
          device: moved,
          credentials: {
            app: "gpslogger",
            endpoint: "https://trail.example.com/api/osmand",
            accessToken: token,
            url: "https://trail.example.com/api/osmand?lat=%LAT",
            headers: `Authorization: Bearer ${token}`,
          },
        },
      },
    });
    const person = userEvent.setup();
    renderSettings(devicePage);
    await person.click(await screen.findByRole("button", { name: "Issue new token" }));
    const dialog = screen.getByRole("dialog", { name: "Issue a new access token?" });
    await person.click(within(dialog).getByRole("radio", { name: /GPSLogger/ }));
    expect(
      within(dialog).getByText("From now on Trail takes uploads from GPSLogger only"),
    ).toBeInTheDocument();
    await person.click(within(dialog).getByRole("button", { name: "Issue new token" }));
    const issued = await screen.findByRole("dialog", { name: "New token for iPhone 16" });
    expect(within(issued).getByLabelText("HTTP Headers")).toHaveValue(
      `Authorization: Bearer ${token}`,
    );
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ source: "gpslogger" });
  });

  it("renames the device", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      [`PATCH /api/devices/${ids.phone}`]: {
        status: 200,
        body: { device: device({ name: "Old iPhone" }) },
      },
    });
    const person = userEvent.setup();
    renderSettings(devicePage);
    await person.click(await screen.findByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename device" });
    await person.clear(within(dialog).getByLabelText("Name"));
    await person.type(within(dialog).getByLabelText("Name"), "Old iPhone");
    await person.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Renamed to Old iPhone.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ name: "Old iPhone" });
  });

  it("asks for the device's name before deleting it", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderSettings(devicePage);
    await person.click(await screen.findByRole("button", { name: "Delete device" }));
    const dialog = screen.getByRole("dialog", { name: "Delete iPhone 16?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete device" });
    expect(confirm).toBeDisabled();
    await person.type(within(dialog).getByLabelText("Type “iPhone 16” to confirm"), "iPhone 16");
    expect(confirm).toBeEnabled();
  });

  it("goes back to the list it was opened from once deleted, focus on the page", async () => {
    let gone = false;
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": () => ({
        status: 200,
        body: { devices: gone ? [car()] : [device(), car()] },
      }),
      [`DELETE /api/devices/${ids.phone}`]: () => {
        gone = true;
        return { status: 204 };
      },
    });
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/devices");
    const card = await screen.findByRole("article", { name: "iPhone 16" });
    await person.click(within(card).getByRole("link", { name: "iPhone 16" }));
    await person.click(await screen.findByRole("button", { name: "Delete device" }));
    const dialog = screen.getByRole("dialog", { name: "Delete iPhone 16?" });
    await person.type(within(dialog).getByLabelText("Type “iPhone 16” to confirm"), "iPhone 16");
    await person.click(within(dialog).getByRole("button", { name: "Delete device" }));

    expect(await screen.findByText("iPhone 16 was deleted.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/devices");
    // Back in the history: Back does not lead to the page of the gone device.
    expect(router.state.historyAction).toBe("POP");
    await waitFor(() => expect(screen.queryByRole("article", { name: "iPhone 16" })).toBeNull());
    expect(screen.getByRole("article", { name: "Car" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toHaveFocus(),
    );
  });

  it("leaves for the device list after deleting, without asking for the gone device", async () => {
    let answerDelete: () => void = () => undefined;
    const { calls } = mockApi(standardRoutes());
    const person = userEvent.setup();
    const { queryClient, router } = renderSettings(devicePage);
    await person.click(await screen.findByRole("button", { name: "Delete device" }));
    await person.type(screen.getByLabelText("Type “iPhone 16” to confirm"), "iPhone 16");
    // The server's `device-removed` event may clear the cache before the deletion returns.
    const held = new Promise<void>((resolve) => {
      answerDelete = resolve;
    });
    const fetchMock = vi.mocked(fetch);
    const answered = fetchMock.getMockImplementation();
    let deleted = false;
    let readsAfterDelete = 0;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "DELETE") {
        deleted = true;
        await held;
        return new Response(null, { status: 204 });
      }
      // Gone on the server as soon as the deletion ran there.
      if (deleted && String(input).endsWith(`/api/devices/${ids.phone}`)) {
        readsAfterDelete += 1;
        calls.push({ method: "GET", path: `/api/devices/${ids.phone}`, body: undefined });
        return new Response(
          JSON.stringify({ error: { code: "not_found", message: "No such device." } }),
          { status: 404 },
        );
      }
      return answered === undefined ? new Response(null, { status: 500 }) : answered(input, init);
    });
    await person.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete device" }),
    );
    act(() => removeDeviceFromCache(queryClient, ids.phone));
    // The page lost its device: the confirmation dialog that started the deletion is gone.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => answerDelete());

    expect(await screen.findByText("iPhone 16 was deleted.")).toBeInTheDocument();
    expect(await heading("Devices")).toBeInTheDocument();
    // Opened by its address: the list takes the gone device's place in the history.
    expect(router.state.location.pathname).toBe("/settings/devices");
    expect(router.state.historyAction).toBe("REPLACE");
    // The page lingers during the route transition; it must not ask for the
    // device it just deleted (the browser would log the 404).
    expect(readsAfterDelete).toBe(0);
  });

  it("says so when the device is deleted elsewhere while its page is open", async () => {
    const api = mockApi(standardRoutes());
    const { queryClient } = renderSettings(`${devicePage}/uploads`);
    expect(
      await screen.findByRole("table", { name: "Uploads of this device" }),
    ).toBeInTheDocument();
    const before = api.calls.length;
    // Another tab deleted it: the server's `device-removed` event.
    act(() => removeDeviceFromCache(queryClient, ids.phone));
    expect(await heading("Device not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Devices" })).toHaveAttribute(
      "href",
      "/settings/devices",
    );
    // Nothing more is asked of the gone device.
    expect(api.calls.slice(before).filter((call) => call.path.includes(ids.phone))).toEqual([]);
  });

  it("explains an unknown device, on its page and on the pages of its parts", async () => {
    mockApi(standardRoutes());
    const unknown = "/settings/devices/01926f3a-0000-7000-8000-000000000000";
    const { unmount } = renderSettings(unknown);
    expect(await heading("Device not found")).toBeInTheDocument();
    expect(screen.getByText("There is no such device here")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Devices" })).toHaveAttribute(
      "href",
      "/settings/devices",
    );
    unmount();
    renderSettings(`${unknown}/uploads`);
    expect(await heading("Device not found")).toBeInTheDocument();
  });
});
