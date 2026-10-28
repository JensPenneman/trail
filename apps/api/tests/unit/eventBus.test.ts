import type { ServerEvent } from "@trail/contracts/events";
import { describe, expect, it } from "vitest";
import { EventBus, type EventSubscriber } from "../../src/events/eventBus";

const userId = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a61";
const deviceId = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
const removed: ServerEvent = { type: "device-removed", deviceId };

/** A stream that keeps what it was sent and how often it was pinged and closed. */
function stream(sessionId = "s1") {
  const got: { event: ServerEvent; message: string }[] = [];
  let pings = 0;
  let closed = 0;
  const subscriber: EventSubscriber = {
    sessionId,
    send: (event, message) => got.push({ event, message }),
    ping: () => {
      pings += 1;
    },
    close: () => {
      closed += 1;
    },
  };
  return {
    subscriber,
    got,
    pings: () => pings,
    closed: () => closed,
  };
}

const idOf = (message: string | undefined) => /^id: (.+)$/m.exec(message ?? "")?.[1];

describe("EventBus", () => {
  it("numbers every event of a user, the same id on each of their streams", () => {
    const bus = new EventBus();
    const first = stream();
    const second = stream();
    bus.subscribe(userId, first.subscriber);
    bus.subscribe(userId, second.subscriber);
    bus.publish(userId, removed);
    bus.publish(userId, removed);
    expect(first.got.map(({ message }) => idOf(message))).toEqual(
      second.got.map(({ message }) => idOf(message)),
    );
    const [one, two] = first.got.map(({ message }) => idOf(message) ?? "");
    expect(one?.endsWith(":1")).toBe(true);
    expect(two?.endsWith(":2")).toBe(true);
  });

  it("gives a stream that comes back what it missed, and its own place", () => {
    let now = 0;
    const bus = new EventBus({ now: () => now });
    const first = stream();
    const subscription = bus.subscribe(userId, first.subscriber);
    bus.publish(userId, removed);
    const seen = idOf(first.got.at(-1)?.message) ?? "";
    subscription.unsubscribe();
    // Gone for a minute while two events came.
    now = 60_000;
    bus.publish(userId, removed);
    bus.publish(userId, removed);
    const back = bus.subscribe(userId, stream().subscriber, seen);
    expect(back.position).toBe(seen);
    expect(back.missed?.map(idOf)).toEqual([seen.replace(/:1$/, ":2"), seen.replace(/:1$/, ":3")]);
    expect(subscription.position.endsWith(":0")).toBe(true);
  });

  it("answers a resync to an id it no longer holds, or never held", () => {
    let now = 0;
    const bus = new EventBus({ now: () => now });
    const first = stream();
    bus.subscribe(userId, first.subscriber).unsubscribe();
    const other = new EventBus();
    const elsewhere = other.subscribe(userId, stream().subscriber);
    // An id of another process.
    const fromAnother = bus.subscribe(userId, stream().subscriber, elsewhere.position);
    expect(fromAnother.missed).toBeNull();
    expect(fromAnother.position).not.toBe(elsewhere.position);
    expect(bus.subscribe(userId, stream().subscriber, "garbage").missed).toBeNull();
    // Too long ago: the events since left the ring.
    const listening = stream();
    const subscription = bus.subscribe(userId, listening.subscriber);
    bus.publish(userId, removed);
    const seen = idOf(listening.got.at(-1)?.message) ?? "";
    bus.publish(userId, removed);
    now = 200_000;
    bus.publish(userId, removed);
    expect(bus.subscribe(userId, stream().subscriber, seen).missed).toBeNull();
    subscription.unsubscribe();
  });

  it("sends a stream that missed an event it was not kept for back to a resync", () => {
    const bus = new EventBus();
    const first = stream();
    const subscription = bus.subscribe(userId, first.subscriber);
    bus.publish(userId, removed);
    const seen = idOf(first.got.at(-1)?.message) ?? "";
    subscription.unsubscribe();
    bus.miss(userId);
    expect(bus.subscribe(userId, stream().subscriber, seen).missed).toBeNull();
  });

  it("keeps nothing for a user nobody follows", () => {
    const bus = new EventBus();
    bus.publish(userId, removed);
    expect(bus.follows(userId)).toBe(false);
    expect(bus.ringUsage()).toEqual({ rings: 0, chars: 0 });
  });

  it("drops a user's ring two minutes after their last stream closed, not before", () => {
    let now = 0;
    const bus = new EventBus({ now: () => now });
    const subscription = bus.subscribe(userId, stream().subscriber);
    bus.publish(userId, removed);
    subscription.unsubscribe();
    now = 100_000;
    bus.sweep();
    expect(bus.follows(userId)).toBe(true);
    now = 121_000;
    bus.sweep();
    expect(bus.follows(userId)).toBe(false);
    expect(bus.ringUsage().rings).toBe(0);
  });

  it("drops the ring of a deleted account at once", () => {
    const bus = new EventBus();
    bus.subscribe(userId, stream().subscriber);
    bus.disconnectUser(userId);
    expect(bus.follows(userId)).toBe(false);
  });

  it("checks a thousand streams' sessions in one statement per tick", async () => {
    const calls: (readonly string[])[] = [];
    const bus = new EventBus({
      activeSessions: async (ids) => {
        calls.push(ids);
        return new Set(ids.filter((id) => id !== "session-7"));
      },
    });
    const streams = Array.from({ length: 1_000 }, (_, index) => stream(`session-${index % 500}`));
    for (const [index, each] of streams.entries()) {
      bus.subscribe(`user-${index % 100}`, each.subscriber);
    }
    expect(bus.streamCount()).toBe(1_000);
    expect(await bus.tick()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(500);
    expect(streams.every((each) => each.pings() === 1)).toBe(true);
    // The two streams of the ended session were told, then closed.
    const ended = streams.filter((each) => each.closed() > 0);
    expect(ended).toHaveLength(2);
    for (const each of ended) expect(each.got.at(-1)?.event).toEqual({ type: "session-ended" });
    await bus.tick();
    expect(calls).toHaveLength(2);
  });

  it("does not end a stream opened while the check ran, nor run two checks at once", async () => {
    let release: (ids: ReadonlySet<string>) => void = () => {};
    let calls = 0;
    const bus = new EventBus({
      activeSessions: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    bus.subscribe(userId, stream("old").subscriber);
    const checking = bus.tick();
    const late = stream("new");
    bus.subscribe(userId, late.subscriber);
    // The second tick pings, and leaves the sessions to the check still running.
    expect(await bus.tick()).toBe(false);
    expect(calls).toBe(1);
    release(new Set(["old"]));
    expect(await checking).toBe(true);
    expect(late.closed()).toBe(0);
  });

  it("keeps ticking quietly when the check fails", async () => {
    const bus = new EventBus({
      activeSessions: async () => {
        throw new Error("the database is away");
      },
    });
    const each = stream();
    bus.subscribe(userId, each.subscriber);
    await expect(bus.tick()).resolves.toBe(true);
    expect(each.closed()).toBe(0);
    expect(each.pings()).toBe(1);
  });

  it("checks nothing without a check, or without a stream", async () => {
    expect(await new EventBus().tick()).toBe(false);
    const bus = new EventBus({ activeSessions: async (ids) => new Set(ids) });
    expect(await bus.tick()).toBe(false);
  });
});
