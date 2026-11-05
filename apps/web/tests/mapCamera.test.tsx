import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { cameraDiffers } from "../src/map/cameraDiffers";
import { PeoplePage } from "../src/pages/people/PeoplePage";
import { user } from "./support/fixtures";
import { stubMap } from "./support/mapStub";
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

  it("is dropped, in place of its entry, once the map reports a view that is not the camera", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=heat&person=me&c=3.7,51.05,13.5",
      user,
    });
    await screen.findByRole("img", { name: /^Heatmap/ });
    expect(router.state.location.search).toContain("c=3.7,51.05,13.5");
    // The same view again changes nothing.
    act(() => stubMap.report({ bounds: [3.5, 51.0, 3.9, 51.1], zoom: 13.5 }));
    expect(router.state.location.search).toContain("c=");
    // A pan: the address no longer names the camera, and it was not a step of the history.
    act(() => stubMap.report({ bounds: [3.6, 50.9, 4.0, 51.0], zoom: 13.5 }));
    await waitFor(() => expect(router.state.location.search).not.toContain("c="));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.search).toContain("view=heat");
  });

  it("holds back no fit of the view it was not asked for: Heat with a camera, then History", async () => {
    mockApi(standardRoutes());
    const person = userEvent.setup();
    renderPage(<PeoplePage />, { url: "/?view=heat&person=me&c=3.7,51.05,13.5", user });
    await screen.findByRole("img", { name: /^Heatmap/ });
    expect(map()).toHaveAttribute("data-fit", "");
    await person.click(
      within(screen.getByRole("group", { name: "Map view" })).getByRole("radio", {
        name: "History",
      }),
    );
    // History frames its day as it always does: nothing of the camera is held against it.
    await waitFor(() => expect(map().getAttribute("data-fit")).toMatch(/\|me\|/));
  });

  it("holds the fit of the view it opens on for good: leaving the camera does not snap to the data", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=history&person=me&c=3.7,51.05,13.5",
      user,
    });
    await screen.findByRole("img", { name: /^Map/ });
    await waitFor(() => expect(map().getAttribute("data-initial-view")).not.toBe("null"));
    // History's fit at load is held while the map is at the camera.
    expect(map()).toHaveAttribute("data-fit", "");
    act(() => stubMap.report({ bounds: [3.6, 50.9, 4.0, 51.0], zoom: 12 }));
    await waitFor(() => expect(router.state.location.search).not.toContain("c="));
    // The key it held counts as fitted: the first pan does not frame the day.
    expect(map()).toHaveAttribute("data-fit", "");
  });

  it("frames another key after the hold: the next day is fitted", async () => {
    mockApi(standardRoutes());
    const { router } = renderPage(<PeoplePage />, {
      url: "/?view=history&person=me&c=3.7,51.05,13.5",
      user,
    });
    await screen.findByRole("img", { name: /^Map/ });
    await waitFor(() => expect(map().getAttribute("data-initial-view")).not.toBe("null"));
    act(() => stubMap.report({ bounds: [3.6, 50.9, 4.0, 51.0], zoom: 12 }));
    await waitFor(() => expect(router.state.location.search).not.toContain("c="));
    await router.navigate("/?view=history&person=me&from=2026-09-01&to=2026-09-07");
    await waitFor(() => expect(map().getAttribute("data-fit")).toMatch(/\|me\|/));
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
