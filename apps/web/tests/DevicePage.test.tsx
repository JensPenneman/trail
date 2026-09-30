import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DevicePage } from "../src/pages/device/DevicePage";
import { ids, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

describe("DevicePage", () => {
  it("shows the device's state, uploads, raw points and settings", async () => {
    mockApi(standardRoutes());
    renderPage(<DevicePage />, { path: "/devices/:deviceId", url: `/devices/${ids.phone}`, user });
    expect(await screen.findByRole("heading", { level: 1, name: "iPhone 16" })).toBeInTheDocument();
    expect(screen.getByText("iphone-16-k3f9")).toBeInTheDocument();
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
