import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LivePage } from "../src/pages/live/LivePage";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

describe("LivePage", () => {
  it("proves each device is sending: status, last upload, battery and today's numbers", async () => {
    mockApi(standardRoutes());
    renderPage(<LivePage />, { user });
    const phone = await screen.findByRole("article", { name: "iPhone 16" });
    expect(within(phone).getByText("Live")).toBeInTheDocument();
    expect(within(phone).getByText(/1 min ago/)).toBeInTheDocument();
    expect(within(phone).getByText("62%")).toBeInTheDocument();
    expect(within(phone).getByText("1,066")).toBeInTheDocument();
    expect(within(phone).getByText(/50\.9845° N/)).toBeInTheDocument();
    expect(
      await within(phone).findByRole("img", { name: /iPhone 16, last 48 hours/ }),
    ).toBeInTheDocument();

    const car = screen.getByRole("article", { name: "Car" });
    expect(within(car).getByText("Idle")).toBeInTheDocument();

    const map = await screen.findByRole("img", { name: /Map of today’s tracks/ });
    expect(map).toHaveAttribute("data-positions", "2");
    expect(await screen.findByText("+40 points")).toBeInTheDocument();
  });

  it("invites to add a first device when there are none", async () => {
    mockApi({ ...standardRoutes(), "GET /api/devices": { status: 200, body: { devices: [] } } });
    renderPage(<LivePage />, { user });
    expect(await screen.findByText("Connect your first phone")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a device" })).toHaveAttribute(
      "href",
      "/devices?add=1",
    );
  });

  it("offers a retry when the devices cannot be loaded", async () => {
    mockApi({
      ...standardRoutes(),
      "GET /api/devices": {
        status: 503,
        body: { error: { code: "unavailable", message: "Database down" } },
      },
    });
    renderPage(<LivePage />, { user });
    expect(await screen.findByText("Devices could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Database down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
