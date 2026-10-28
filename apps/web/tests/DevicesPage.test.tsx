import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { device, ids } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderSettings } from "./support/renderSettings";
import { standardRoutes } from "./support/standardRoutes";

const created = {
  device: device({
    id: "01926f40-4a71-7c93-a465-7f8091a2b3c4",
    name: "Lotte’s iPhone",
    deviceKey: "lottes-iphone-x2k8",
    lastSeenAt: null,
    lastLocation: null,
    battery: null,
    counts: { today: 0, last24h: 0, total: 0 },
  }),
  credentials: {
    app: "overland",
    endpoint: "https://trail.example.com/api/overland",
    accessToken: "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS",
    deviceKey: "lottes-iphone-x2k8",
    setupUrl:
      "overland://setup?url=https%3A%2F%2Ftrail.example.com%2Fapi%2Foverland&token=trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS&device_id=lottes-iphone-x2k8",
  },
};

const fact = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label, { selector: "dt" }).nextElementSibling;

const heading = (name: string) => screen.findByRole("heading", { level: 1, name });

describe("Settings › Devices", () => {
  it("is a page of Settings, with the way back to its list and adding a device", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/devices");
    expect(await heading("Devices")).toBeInTheDocument();
    expect(document.title).toBe("Devices · Settings · Trail");
    expect(screen.getByRole("region", { name: "Devices" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.getByText("Phones that send their location to Trail with a tracking app."),
    ).toBeInTheDocument();
    expect(
      within(await screen.findByRole("list", { name: "Your devices" })).getAllByRole("article"),
    ).toHaveLength(2);
    await person.click(screen.getByRole("button", { name: "Add device" }));
    expect(screen.getByRole("dialog", { name: "Add a device" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?add=1");
  });

  it("proves each device is sending: status, last upload, battery, movement and today", async () => {
    const api = mockApi(standardRoutes());
    renderSettings("/settings/devices");
    expect(await screen.findByText("1 of 2 devices live")).toBeInTheDocument();
    const phone = await screen.findByRole("article", { name: "iPhone 16" });
    expect(within(phone).getByRole("heading", { level: 3, name: "iPhone 16" })).toBeInTheDocument();
    expect(within(phone).getByRole("link", { name: "iPhone 16" })).toHaveAttribute(
      "href",
      `/settings/devices/${ids.phone}`,
    );
    expect(within(phone).getByText("Live")).toBeInTheDocument();
    expect(within(phone).getByText("1 min ago")).toBeInTheDocument();
    expect(within(phone).getByText(/points in total$/)).toHaveTextContent(
      "iphone-16-k3f9 · 184,322 points in total",
    );
    expect(fact(phone, "Battery")).toHaveTextContent("62%");
    expect(fact(phone, "Movement")).toHaveTextContent("Standing still");
    expect(fact(phone, "Points today")).toHaveTextContent("1,066");
    // Today's distance from the day's sums, not from loading its whole track.
    expect(await within(phone).findByText("32.9 km")).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).not.toContain("/api/tracks");
    expect(fact(phone, "Last position")).toHaveTextContent(/50\.9845° N, 3\.5268° E ±12 m/);
    expect(
      await within(phone).findByRole("img", { name: /iPhone 16, last 48 hours/ }),
    ).toBeInTheDocument();

    const car = screen.getByRole("article", { name: "Car" });
    expect(within(car).getByText("Idle")).toBeInTheDocument();
    expect(fact(car, "Movement")).toHaveTextContent("Last seen standing still");
  });

  it("opens a device's page from its card, and comes back to the card", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderSettings("/settings/devices");
    const phone = await screen.findByRole("article", { name: "iPhone 16" });
    await person.click(within(phone).getByRole("link", { name: "iPhone 16" }));
    expect(await heading("iPhone 16")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/settings/devices/${ids.phone}`);
    expect(document.title).toBe("iPhone 16 · Devices · Settings · Trail");
    await person.click(screen.getByRole("link", { name: "Back to Devices" }));
    expect(await heading("Devices")).toBeInTheDocument();
    // Back in the history, and the focus on the card it came from.
    expect(router.state.historyAction).toBe("POP");
    await waitFor(() =>
      expect(
        within(screen.getByRole("article", { name: "iPhone 16" })).getByRole("link", {
          name: "iPhone 16",
        }),
      ).toHaveFocus(),
    );
  });

  it("leads a device still waiting for its first upload to its setup", async () => {
    const waiting = device({ lastSeenAt: null, lastLocation: null, battery: null });
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": { status: 200, body: { devices: [waiting] } },
    });
    renderSettings("/settings/devices");
    const card = await screen.findByRole("article", { name: "iPhone 16" });
    expect(within(card).getByText(/^Waiting for the first upload\./)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Setup details" })).toHaveAttribute(
      "href",
      `/settings/devices/${ids.phone}/setup`,
    );
  });

  it("says when there are no devices yet, and how to add the first", async () => {
    mockApi({ ...standardRoutes(), "GET /api/devices": { status: 200, body: { devices: [] } } });
    const person = userEvent.setup();
    renderSettings("/settings/devices");
    expect(await screen.findByRole("heading", { name: "No devices yet" })).toBeInTheDocument();
    expect(screen.queryByText(/devices? live/)).toBeNull();
    await person.click(screen.getByRole("button", { name: "Add your first device" }));
    expect(screen.getByRole("dialog", { name: "Add a device" })).toBeInTheDocument();
  });

  it("lists the uploads as they arrive, newest first", async () => {
    mockApi(standardRoutes());
    const { liveStore } = renderSettings("/settings/devices");
    const uploads = await screen.findByRole("list", { name: "Uploads" });
    expect(await within(uploads).findByText("+40 points")).toBeInTheDocument();
    expect(within(uploads).getByText(/1 rejected/)).toBeInTheDocument();
    act(() =>
      liveStore.addUpload({
        deviceId: ids.phone,
        receivedAt: new Date().toISOString(),
        inserted: 12,
        duplicates: 0,
        rejected: 0,
      }),
    );
    const first = within(uploads).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("+12 points");
    expect(first).toHaveTextContent("New");
  });

  it("asks for today's sums again while uploads keep coming, however close together", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = mockApi(standardRoutes());
      const { liveStore } = renderSettings("/settings/devices");
      await screen.findByRole("article", { name: "iPhone 16" });
      const asked = () => api.calls.filter((call) => call.path === "/api/stats/days").length;
      await waitFor(() => expect(asked()).toBe(1));
      // Two phones, or Send Now: an upload every 5 s for half a minute.
      for (let second = 0; second < 30; second += 5) {
        act(() =>
          liveStore.addUpload({
            deviceId: ids.phone,
            receivedAt: new Date().toISOString(),
            inserted: 3,
            duplicates: 0,
            rejected: 0,
          }),
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
      }
      // The server sums the day up 10 s after a run's first upload: the page keeps up.
      expect(asked()).toBeGreaterThanOrEqual(3);
      const during = asked();
      // A minute and a bit after the last upload it stops asking.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80_000);
      });
      const after = asked();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40_000);
      });
      expect(asked()).toBe(after);
      expect(after).toBeGreaterThan(during);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds a device and shows its one-time setup code while waiting for the first upload", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      "POST /api/devices": { status: 201, body: created },
      [`GET /api/devices/${created.device.id}`]: { status: 200, body: { device: created.device } },
    });
    const person = userEvent.setup();
    renderSettings("/settings/devices");
    await person.click(await screen.findByRole("button", { name: "Add device" }));
    const dialog = screen.getByRole("dialog", { name: "Add a device" });
    await person.type(within(dialog).getByLabelText("Name"), "Lotte’s iPhone");
    await person.click(within(dialog).getByRole("button", { name: "Add device" }));

    expect(
      await screen.findByRole("dialog", { name: "Set up Lotte’s iPhone" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Setup code for Lotte’s iPhone/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Access token")).toHaveValue(created.credentials.accessToken);
    expect(screen.getByText("Waiting for the first upload…")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Lotte’s iPhone",
      source: "overland",
    });
  });

  it("adds a device for another app and shows that app's setup", async () => {
    const pixel = device({
      id: "01926f40-4a71-7c93-a465-7f8091a2b3c5",
      name: "Lotte’s Pixel",
      source: "traccar",
      lastSeenAt: null,
      lastLocation: null,
      battery: null,
      counts: { today: 0, last24h: 0, total: 0 },
    });
    const token = "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";
    const { calls } = mockApi({
      ...standardRoutes(),
      "POST /api/devices": {
        status: 201,
        body: {
          device: pixel,
          credentials: {
            app: "traccar",
            endpoint: "https://trail.example.com/api/osmand",
            accessToken: token,
            setupUrl: `org.traccar.client://setup?url=https%3A%2F%2Ftrail.example.com%2Fapi%2Fosmand&id=${token}`,
          },
        },
      },
      [`GET /api/devices/${pixel.id}`]: { status: 200, body: { device: pixel } },
    });
    const person = userEvent.setup();
    renderSettings("/settings/devices?add=1");
    const dialog = await screen.findByRole("dialog", { name: "Add a device" });
    await person.type(within(dialog).getByLabelText("Name"), "Lotte’s Pixel");
    const apps = within(dialog).getByRole("group", { name: "App on the phone" });
    expect(
      within(apps)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["overland", "owntracks", "traccar", "osmand", "gpslogger"]);
    expect(
      within(apps).getByText(/^iOS and Android · One point per request, buffered/),
    ).toBeInTheDocument();
    await person.click(within(apps).getByRole("radio", { name: /Traccar Client/ }));
    // Only Overland and OwnTracks have a use for the device key.
    expect(within(dialog).queryByText("Device ID (optional)")).toBeNull();
    await person.click(within(dialog).getByRole("button", { name: "Add device" }));

    const setup = await screen.findByRole("dialog", { name: "Set up Lotte’s Pixel" });
    expect(
      within(setup).getByText("Connect Traccar Client on the phone to Trail."),
    ).toBeInTheDocument();
    expect(within(setup).getByLabelText("Device identifier (access token)")).toHaveValue(token);
    expect(
      within(setup).getByText(/In Traccar Client, turn Continuous tracking on/),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Lotte’s Pixel",
      source: "traccar",
    });
  });

  it("says which name is missing instead of sending an empty device", async () => {
    const { calls } = mockApi(standardRoutes());
    const person = userEvent.setup();
    renderSettings("/settings/devices?add=1");
    const dialog = await screen.findByRole("dialog", { name: "Add a device" });
    await person.click(within(dialog).getByRole("button", { name: "Add device" }));
    expect(within(dialog).getByText("Give the device a name.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});
