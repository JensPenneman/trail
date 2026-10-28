import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { cacheValidators } from "../src/cache/cacheValidators";
import { createLiveStore } from "../src/live/createLiveStore";
import { LiveStoreContext } from "../src/live/LiveStoreContext";
import { useDays } from "../src/queries/useDays";
import { useTimeline } from "../src/queries/useTimeline";
import { dayStamp, ids, timeline, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";
import { createTestQueryClient } from "./support/renderPage";

const range = {
  from: "2026-10-27T23:00:00.000Z",
  to: "2026-10-28T23:00:00.000Z",
  deviceIds: null,
};
const stamps = [dayStamp(ids.phone, "2026-10-28")];

function hookWith(store = createLiveStore()) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.session, user);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <LiveStoreContext value={store}>{children}</LiveStoreContext>
    </QueryClientProvider>
  );
  return { queryClient, store, wrapper };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the timeline's revalidation", () => {
  it("reads every page, and keeps the first page's stamps and ETag for the whole range", async () => {
    const [stop, train] = timeline(range.from);
    const { calls } = mockApi({
      "GET /api/v1/segments": ({ url }) =>
        url.searchParams.get("cursor") === null
          ? {
              status: 200,
              body: { items: [stop], nextCursor: "page-2", pending: false, stamps },
              etag: 'W/"timeline"',
            }
          : { status: 200, body: { items: [train], nextCursor: null, pending: true, stamps } },
    });
    const { queryClient, wrapper } = hookWith();
    const { result } = renderHook(() => useTimeline(range), { wrapper });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
    expect(result.current.data).toEqual({ items: [stop, train], pending: true, stamps });
    expect(cacheValidators.get(queryClient, queryKeys.timeline(range))).toBe('W/"timeline"');
    expect(calls).toHaveLength(2);
  });

  it("keeps every page on screen when the first page comes back 304", async () => {
    const shown = { items: timeline(range.from), pending: false, stamps };
    const { calls } = mockApi({
      "GET /api/v1/segments": {
        status: 200,
        body: { items: [], nextCursor: null, pending: false },
        etag: 'W/"timeline"',
      },
    });
    const { queryClient, wrapper } = hookWith();
    queryClient.setQueryData(queryKeys.timeline(range), shown, { updatedAt: 1 });
    cacheValidators.set(queryClient, queryKeys.timeline(range), 'W/"timeline"');
    const { result } = renderHook(() => useTimeline(range), { wrapper });
    await waitFor(() => expect(calls[0]?.status).toBe(304));
    await waitFor(() => expect(result.current.dataUpdatedAt).toBeGreaterThan(1));
    expect(result.current.data).toBe(shown);
    expect(calls).toHaveLength(1);
  });
});

describe("the daily totals while uploads come in", () => {
  const days = { from: "2026-10-28", to: "2026-10-28", deviceIds: null };
  const answer = { timezone: user.timezone, days: [] };

  it("are asked for again on the page's interval from a server without days events", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = mockApi({ "GET /api/stats/days": { status: 200, body: answer } });
    const { wrapper } = hookWith();
    renderHook(() => useDays(days, { refetchInterval: 10_000 }), { wrapper });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(calls.length).toBeGreaterThan(1);
  });

  it("are not polled once the server tells of every change with its days events", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = mockApi({ "GET /api/stats/days": { status: 200, body: answer } });
    const store = createLiveStore();
    store.setServer({ sendsDays: true });
    const { wrapper } = hookWith(store);
    renderHook(() => useDays(days, { refetchInterval: 10_000 }), { wrapper });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls).toHaveLength(1);
  });
});
