import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DevicesPage } from "../src/pages/devices/DevicesPage";
import { device, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
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
    endpoint: "https://trail.example.com/api/overland",
    accessToken: "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS",
    deviceKey: "lottes-iphone-x2k8",
    setupUrl:
      "overland://setup?url=https%3A%2F%2Ftrail.example.com%2Fapi%2Foverland&token=trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS&device_id=lottes-iphone-x2k8",
  },
};

describe("DevicesPage", () => {
  it("lists the devices with their status", async () => {
    mockApi(standardRoutes());
    renderPage(<DevicesPage />, { path: "/devices", user });
    const phone = await screen.findByRole("link", { name: /iPhone 16/ });
    expect(phone).toHaveAttribute("href", "/devices/01926f3a-9c3d-7e5f-a021-3b4c5d6e7f80");
    expect(within(phone).getByText("Live")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Car/ })).getByText("Idle")).toBeInTheDocument();
  });

  it("adds a device and shows its one-time setup code while waiting for the first upload", async () => {
    const { calls } = mockApi({
      ...standardRoutes(),
      "POST /api/devices": { status: 201, body: created },
      [`GET /api/devices/${created.device.id}`]: { status: 200, body: { device: created.device } },
    });
    const person = userEvent.setup();
    renderPage(<DevicesPage />, { path: "/devices", user });
    await person.click(screen.getByRole("button", { name: "Add device" }));
    const dialog = screen.getByRole("dialog", { name: "Add a device" });
    await person.type(within(dialog).getByLabelText("Name"), "Lotte’s iPhone");
    await person.click(within(dialog).getByRole("button", { name: "Add device" }));

    expect(
      await screen.findByRole("dialog", { name: "Set up Lotte’s iPhone" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Setup code for Lotte’s iPhone/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Access token")).toHaveValue(created.credentials.accessToken);
    expect(screen.getByText("Waiting for the first upload…")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Lotte’s iPhone" });
  });

  it("says which name is missing instead of sending an empty device", async () => {
    const { calls } = mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<DevicesPage />, { path: "/devices", url: "/devices?add=1", user });
    const dialog = await screen.findByRole("dialog", { name: "Add a device" });
    await person.click(within(dialog).getByRole("button", { name: "Add device" }));
    expect(within(dialog).getByText("Give the device a name.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});
