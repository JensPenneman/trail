import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { DaysResponse } from "@trail/contracts/stats";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { settleDay, settledStaleTime } from "../src/cache/settledDay";
import { dayStamp, ids, tracks, user } from "./support/fixtures";

const from = "2026-10-25T23:00:00.000Z";
const to = "2026-10-26T23:00:00.000Z";
const day = { from, to, deviceIds: null };
const monthKey = queryKeys.days({ from: "2026-10-01", to: "2026-10-31", deviceIds: null });
const answer = { ...tracks(from, to), stamps: [dayStamp(ids.phone, "2026-10-26", "r1", "p1")] };

const digest = (raw: string): DaysResponse => ({
  timezone: user.timezone,
  days: [
    {
      date: "2026-10-26",
      deviceId: ids.phone,
      points: 3,
      distanceM: 1250,
      firstAt: from,
      lastAt: to,
      stamp: { raw, processed: "p1" },
    },
  ],
});

function client() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.session, user);
  queryClient.setQueryData(queryKeys.tracks(day), answer);
  return queryClient;
}

const staleTimeOf = (queryClient: QueryClient) => {
  const query = queryClient.getQueryCache().find({ queryKey: queryKeys.tracks(day) });
  if (query === undefined) throw new Error("no query");
  return settledStaleTime(queryClient, "tracks")(query);
};

describe("a settled past day", () => {
  it("never goes stale while a fresh digest has its stamps", () => {
    const queryClient = client();
    queryClient.setQueryData(monthKey, digest("r1"));
    expect(staleTimeOf(queryClient)).toBe(Number.POSITIVE_INFINITY);
  });

  it("goes stale as soon as the digest's stamp differs, or the digest is not fresh", () => {
    const queryClient = client();
    queryClient.setQueryData(monthKey, digest("r2"));
    expect(staleTimeOf(queryClient)).toBe(30_000);
    queryClient.setQueryData(monthKey, digest("r1"), { updatedAt: Date.now() - 61_000 });
    expect(staleTimeOf(queryClient)).toBe(30_000);
  });

  it("is not settled by a digest of other devices, of another zone, or without one", () => {
    const queryClient = client();
    expect(staleTimeOf(queryClient)).toBe(30_000);
    queryClient.setQueryData(
      queryKeys.days({ from: "2026-10-01", to: "2026-10-31", deviceIds: [ids.phone] }),
      digest("r1"),
    );
    // The answer is of every device; a digest of the phone alone cannot vouch for the car.
    expect(staleTimeOf(queryClient)).toBe(30_000);
    queryClient.setQueryData(monthKey, { ...digest("r1"), timezone: "Europe/Lisbon" });
    expect(staleTimeOf(queryClient)).toBe(30_000);
  });

  it("is never today, and never a range", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.session, user);
    const range = { from: "2026-10-20T22:00:00.000Z", to: to, deviceIds: null };
    queryClient.setQueryData(queryKeys.tracks(range), answer);
    queryClient.setQueryData(monthKey, digest("r1"));
    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.tracks(range) });
    if (query === undefined) throw new Error("no query");
    expect(settledStaleTime(queryClient, "tracks")(query)).toBe(30_000);
  });

  it("waits for a digest on its way before deciding", async () => {
    const queryClient = client();
    let answerDigest: (digest: DaysResponse) => void = () => undefined;
    void queryClient.fetchQuery({
      queryKey: monthKey,
      queryFn: () =>
        new Promise<DaysResponse>((resolve) => {
          answerDigest = resolve;
        }),
    });
    const settled = settleDay(queryClient, queryKeys.tracks(day), answer);
    answerDigest(digest("r1"));
    expect(await settled).toBe(true);
  });

  it("asks a digest on screen again first when it is no longer fresh", async () => {
    const queryClient = client();
    const fetchDigest = vi.fn(async () => digest("r1"));
    const observer = new QueryObserver(queryClient, {
      queryKey: monthKey,
      queryFn: fetchDigest,
      staleTime: 60_000,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await expect.poll(() => fetchDigest.mock.calls.length).toBe(1);
    queryClient.setQueryData(monthKey, digest("r1"), { updatedAt: Date.now() - 120_000 });
    expect(await settleDay(queryClient, queryKeys.tracks(day), answer)).toBe(true);
    expect(fetchDigest).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
