import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { FreshnessIndicator } from "../src/app/FreshnessIndicator";
import { useDevices } from "../src/queries/useDevices";
import { device, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { createTestQueryClient, renderPage } from "./support/renderPage";

/** A page with live data: the devices, as People and Devices show them. */
function LivePage() {
  useDevices();
  return null;
}

const line = () => document.querySelector(".freshness");
const lineText = () => document.querySelector(".freshness__text")?.textContent;
const announced = () => document.querySelector(".freshness [role='status']")?.textContent;

afterEach(() => {
  vi.useRealTimers();
});

describe("FreshnessIndicator", () => {
  it("says nothing on a page without live data", () => {
    renderPage(<FreshnessIndicator />, { user });
    expect(line()).not.toBeVisible();
  });

  it("says how old the copy from the last visit is, then that it updates, then live", async () => {
    let answer: (response: { status: number; body: unknown }) => void = () => undefined;
    mockApi({
      "GET /api/devices": () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      queryKeys.devices,
      { devices: [device()] },
      {
        updatedAt: Date.now() - 3 * 60_000 - 5000,
      },
    );
    const { liveStore } = renderPage(
      <>
        <FreshnessIndicator />
        <LivePage />
      </>,
      { user, queryClient },
    );
    // Stale: asked for again at once.
    expect(await screen.findByText("Updating…")).toBeInTheDocument();
    expect(line()).toHaveClass("freshness--updating");
    act(() => answer({ status: 200, body: { devices: [device()] } }));
    expect(await screen.findByText("Updated just now")).toBeInTheDocument();
    act(() => liveStore.setConnection("open"));
    expect(lineText()).toBe("Live");
    expect(line()).toHaveClass("freshness--live");
  });

  it("says when the copy is from while it is not asked for again", () => {
    mockApi({});
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      queryKeys.devices,
      { devices: [device()] },
      {
        updatedAt: Date.now() - 3 * 60_000 - 5000,
      },
    );
    queryClient.setQueryDefaults(queryKeys.devices, { staleTime: Number.POSITIVE_INFINITY });
    renderPage(
      <>
        <FreshnessIndicator />
        <LivePage />
      </>,
      { user, queryClient },
    );
    expect(lineText()).toBe("Updated 3 min ago");
    expect(line()).toHaveClass("freshness--stored");
  });

  it("says offline, and as of when, without a network", () => {
    mockApi({});
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const queryClient = createTestQueryClient();
    const fetchedAt = Date.parse("2026-10-28T09:32:00.000Z");
    queryClient.setQueryData(queryKeys.devices, { devices: [device()] }, { updatedAt: fetchedAt });
    queryClient.setQueryDefaults(queryKeys.devices, { staleTime: Number.POSITIVE_INFINITY });
    renderPage(
      <>
        <FreshnessIndicator />
        <LivePage />
      </>,
      { user, queryClient },
    );
    expect(lineText()).toBe("Offline · as of 10:32");
    expect(announced()).toBe("Offline, showing what Trail kept, as of 10:32");
  });

  it("announces a change of state at most once a minute, never the minutes ticking", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({ "GET /api/devices": { status: 200, body: { devices: [device()] } } });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.devices, { devices: [device()] });
    queryClient.setQueryDefaults(queryKeys.devices, { staleTime: Number.POSITIVE_INFINITY });
    const { liveStore } = renderPage(
      <>
        <FreshnessIndicator />
        <LivePage />
      </>,
      { user, queryClient },
    );
    const first = announced();
    expect(first).toMatch(/^Showing what Trail kept, updated at/);
    act(() => liveStore.setConnection("open"));
    expect(lineText()).toBe("Live");
    // Within the minute the region keeps its last words…
    expect(announced()).toBe(first);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    // …and says the new state once it may.
    expect(announced()).toBe("Live");
  });
});
