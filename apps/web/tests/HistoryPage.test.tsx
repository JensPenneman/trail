import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistoryPage } from "../src/pages/history/HistoryPage";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

describe("HistoryPage", () => {
  it("shows the day's totals, visits, trips and a time slider", async () => {
    mockApi(standardRoutes());
    renderPage(<HistoryPage />, { path: "/history", user });
    expect(screen.getByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
    expect(await screen.findByText("1.3 km")).toBeInTheDocument();
    expect(screen.getByText(/3 points/)).toBeInTheDocument();
    expect(await screen.findByRole("slider", { name: "Position at" })).toBeInTheDocument();
    expect(await screen.findByText(/Bike ride · 8\.4 km/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Show this visit on the map/ })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Devices" })).toBeInTheDocument();
  });

  it("moves between days and opens the calendar", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    const { router } = renderPage(<HistoryPage />, {
      path: "/history",
      url: "/history?date=2026-09-12",
      user,
    });
    await person.click(screen.getByRole("button", { name: "Previous day" }));
    expect(router.state.location.search).toBe("?date=2026-09-11");
    await person.click(screen.getByRole("button", { name: /choose another day/ }));
    expect(await screen.findByRole("grid", { name: "September 2026" })).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: /Thursday, 10 September 2026/ }));
    expect(router.state.location.search).toBe("?date=2026-09-10");
  });
});
