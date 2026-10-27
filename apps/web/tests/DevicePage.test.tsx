import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { removeDeviceFromCache } from "../src/devices/removeDeviceFromCache";
import { DevicePage } from "../src/pages/device/DevicePage";
import { device, ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

describe("DevicePage", () => {
  it("shows the device's state, uploads, raw points and settings", async () => {
    mockApi(standardRoutes());
    renderPage(<DevicePage />, { path: "/devices/:deviceId", url: `/devices/${ids.phone}`, user });
    expect(await screen.findByRole("heading", { level: 1, name: "iPhone 16" })).toBeInTheDocument();
    const overview = screen.getByRole("region", { name: "Overview" });
    expect(within(overview).getByText("iphone-16-k3f9")).toBeInTheDocument();
    expect(within(overview).getByText("Overland")).toBeInTheDocument();
    const setup = screen.getByRole("region", { name: "Setup" });
    expect(within(setup).getByText("https://trail.example.com/api/overland")).toBeInTheDocument();
    expect(within(setup).getByText("Recommended Overland settings")).toBeInTheDocument();
    expect(
      await screen.findByRole("table", { name: "Uploads of this device" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("table", { name: "Stored points of this device" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Battery saver/ })).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Tell me when this device goes silent" }),
    ).toBeChecked();
    // What the People page's Live view had of it: the hours of activity and the quick toggle.
    expect(
      await within(screen.getByRole("region", { name: "Activity" })).findByRole("img", {
        name: /iPhone 16, last 48 hours: 40 points in 1 of 48 hours, 3 uploads\./,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Travelling now" })).getByRole("group", {
        name: "Now:",
      }),
    ).toBeInTheDocument();
  });

  it("shows another app's setup and no Overland presets", async () => {
    const pixel = device({ source: "owntracks", deviceKey: "pixel-k3f9", name: "Pixel 8" });
    mockApi({
      ...standardRoutes(),
      [`GET /api/devices/${ids.phone}`]: { status: 200, body: { device: pixel } },
    });
    const person = userEvent.setup();
    renderPage(<DevicePage />, { path: "/devices/:deviceId", url: `/devices/${ids.phone}`, user });
    expect(await screen.findByRole("heading", { level: 1, name: "Pixel 8" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Tracking settings" })).toBeNull();
    const setup = screen.getByRole("region", { name: "Setup" });
    expect(within(setup).getByText(/^OwnTracks \(iOS and Android\)/)).toBeInTheDocument();
    expect(within(setup).getByText("https://trail.example.com/api/owntracks")).toBeInTheDocument();
    expect(within(setup).getByText("P8")).toBeInTheDocument();
    expect(within(setup).getByText(/…q7Zx/)).toBeInTheDocument();
    await person.click(within(setup).getByRole("radio", { name: "Android" }));
    expect(
      within(setup).getByText("Recommended OwnTracks settings on Android"),
    ).toBeInTheDocument();
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
    renderPage(<DevicePage />, { path: "/devices/:deviceId", url: `/devices/${ids.phone}`, user });
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

  it("asks for the device's name before deleting it", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<DevicePage />, { path: "/devices/:deviceId", url: `/devices/${ids.phone}`, user });
    await person.click(await screen.findByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("button", { name: "Delete device" });
    expect(confirm).toBeDisabled();
    await person.type(screen.getByLabelText("Type “iPhone 16” to confirm"), "iPhone 16");
    expect(confirm).toBeEnabled();
  });

  it("leaves for the device list after deleting, without asking for the gone device", async () => {
    let answerDelete: () => void = () => undefined;
    const { calls } = mockApi(standardRoutes());
    const person = userEvent.setup();
    const { queryClient, router } = renderPage(<DevicePage />, {
      path: "/devices/:deviceId",
      url: `/devices/${ids.phone}`,
      user,
    });
    await person.click(await screen.findByRole("button", { name: "Delete" }));
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
    await person.click(screen.getByRole("button", { name: "Delete device" }));
    act(() => removeDeviceFromCache(queryClient, ids.phone));
    // The page lost its device: the confirmation dialog that started the deletion is gone.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => answerDelete());

    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/devices");
    expect(await screen.findByText("iPhone 16 was deleted.")).toBeInTheDocument();
    // The page lingers during the route transition; it must not ask for the
    // device it just deleted (the browser would log the 404).
    expect(readsAfterDelete).toBe(0);
  });

  it("explains an unknown device", async () => {
    mockApi(standardRoutes());
    renderPage(<DevicePage />, {
      path: "/devices/:deviceId",
      url: "/devices/01926f3a-0000-7000-8000-000000000000",
      user,
    });
    expect(await screen.findByText("There is no such device")).toBeInTheDocument();
  });
});
