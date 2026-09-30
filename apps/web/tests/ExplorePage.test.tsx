import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExplorePage } from "../src/pages/explore/ExplorePage";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

describe("ExplorePage", () => {
  it("summarises everything recorded and hands the heatmap its place", async () => {
    mockApi(standardRoutes());
    renderPage(<ExplorePage />, { path: "/explore", user });
    expect(screen.getByRole("heading", { level: 1, name: "Explore" })).toBeInTheDocument();
    // 184,322 + 41,207 points over both devices.
    expect(await screen.findByText("225,529")).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: /Heatmap of all recorded points/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Fewer points")).toBeInTheDocument();
  });
});
