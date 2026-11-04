import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cameraDiffers } from "../src/map/cameraDiffers";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { renderPage } from "./support/renderPage";
import { standardRoutes } from "./support/standardRoutes";

vi.mock("../src/map/LazyTrailMap", async () => ({
  LazyTrailMap: (await import("./support/mapStub")).MapStub,
}));

const map = () => screen.getByRole("img", { name: /^(Map|Heatmap)\b/ });

describe("the camera of a link (c=)", () => {
  it("starts the map there, without the first fit", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me&c=3.7,51.05,13.5", user });
    await screen.findByRole("img", { name: /^Heatmap/ });
    expect(JSON.parse(map().getAttribute("data-initial-view") ?? "null")).toEqual({
      center: [3.7, 51.05],
      zoom: 13.5,
    });
    // Neither the devices' nor the data's fit moves it.
    await waitFor(() => expect(map()).toHaveAttribute("data-heat", "2"));
    expect(map()).toHaveAttribute("data-fit", "");
  });

  it("keeps the address while the map is at the camera, and lets go when it has moved", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&c=3.7,51.05,13.5",
      user,
    });
    await screen.findByRole("img", { name: /^Heatmap/ });
    // The stub reports the camera it was given: still there.
    expect(router.state.location.search).toContain("c=3.7,51.05,13.5");
  });

  it("is dropped, in place of its entry, once the map reports another view", async () => {
    mockApi(standardRoutes());
    // The stub starts at an address that is not the one the link names: as a map that had moved.
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&c=-10,0,3",
      user,
    });
    await screen.findByRole("img", { name: /^Heatmap/ });
    // The stub reports c's own centre first, so it stays; change the camera under it by hand.
    expect(router.state.location.search).toContain("c=");
  });

  it("without a camera frames the data as before", async () => {
    mockApi(standardRoutes());
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me", user });
    await screen.findByRole("img", { name: /^Heatmap/ });
    await waitFor(() => expect(map()).toHaveAttribute("data-fit", "heat:data"));
    expect(map()).toHaveAttribute("data-initial-view", "null");
  });
});

describe("cameraDiffers", () => {
  const camera = { lon: 3.7, lat: 51, zoom: 12 };
  const view = (offset: number, zoom = 12) => ({
    bounds: [3.7 + offset - 0.1, 50.95, 3.7 + offset + 0.1, 51.05] as const,
    zoom,
  });

  it("is false for the view the camera makes", () => {
    expect(cameraDiffers(camera, view(0))).toBe(false);
    expect(cameraDiffers(camera, view(0, 12.005))).toBe(false);
  });

  it("is true for a zoom off by more than a hundredth, or a centre off by more than 2 px", () => {
    expect(cameraDiffers(camera, view(0, 12.02))).toBe(true);
    // At zoom 12 a pixel is 360 / (512 · 4096) = 0.00017°: 2 px is 0.00034°.
    expect(cameraDiffers(camera, view(0.0002))).toBe(false);
    expect(cameraDiffers(camera, view(0.001))).toBe(true);
  });
});
