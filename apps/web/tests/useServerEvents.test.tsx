import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { DeviceListResponse } from "@trail/contracts/device";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { createLiveStore } from "../src/live/createLiveStore";
import { useServerEvents } from "../src/live/useServerEvents";
import { device, ids } from "./support/fixtures";

/** A controllable stand-in for the browser's EventSource. */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.dispatchEvent(new Event("open"));
  }
  send(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  fail(): void {
    this.dispatchEvent(new Event("error"));
  }
}

const latest = () => {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) throw new Error("no stream was opened");
  return source;
};

function setup() {
  const queryClient = new QueryClient();
  queryClient.setQueryData<DeviceListResponse>(queryKeys.devices, { devices: [device()] });
  const store = createLiveStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useServerEvents(store), { wrapper });
  return { queryClient, store, hook };
}

describe("useServerEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the event stream and folds events into the caches", () => {
    const { queryClient, store } = setup();
    expect(latest().url).toBe("/api/events");
    expect(store.getSnapshot().connection).toBe("connecting");
    act(() => latest().open());
    expect(store.getSnapshot().connection).toBe("open");
    act(() => latest().send("device", { type: "device", device: device({ name: "Renamed" }) }));
    expect(queryClient.getQueryData<DeviceListResponse>(queryKeys.devices)?.devices[0]?.name).toBe(
      "Renamed",
    );
  });

  it("reconnects after a failure and only reports trouble that lasts", () => {
    const { store } = setup();
    act(() => latest().open());
    act(() => latest().fail());
    expect(latest().closed).toBe(true);
    // Brief hiccups stay invisible.
    expect(store.getSnapshot().connection).toBe("open");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(FakeEventSource.instances.length).toBeGreaterThan(1);
    expect(store.getSnapshot().connection).toBe("reconnecting");
    act(() => latest().open());
    expect(store.getSnapshot().connection).toBe("open");
  });

  it("closes the stream when the signed-in shell goes away", () => {
    const { hook } = setup();
    const source = latest();
    hook.unmount();
    expect(source.closed).toBe(true);
  });

  it("records uploads announced by the stream", () => {
    const { store } = setup();
    act(() => latest().open());
    act(() =>
      latest().send("ingest", {
        type: "ingest",
        deviceId: ids.phone,
        receivedAt: "2026-09-30T10:00:00.000Z",
        inserted: 12,
        duplicates: 0,
        rejected: 0,
        points: [],
      }),
    );
    expect(store.getSnapshot().uploads).toEqual([
      {
        deviceId: ids.phone,
        receivedAt: "2026-09-30T10:00:00.000Z",
        inserted: 12,
        duplicates: 0,
        rejected: 0,
      },
    ]);
  });
});
