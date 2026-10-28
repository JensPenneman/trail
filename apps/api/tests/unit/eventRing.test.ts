import { describe, expect, it } from "vitest";
import { EventRing, ringLimits } from "../../src/events/eventRing";

const message = (id: string) => `id: ${id}\nevent: device\ndata: {}\n\n`;

/** A ring with `count` events published `stepMs` apart from `start` on. */
function filled(count: number, start = 0, ring = new EventRing(), stepMs = 1_000): EventRing {
  for (let index = 0; index < count; index += 1) ring.push(message, start + index * stepMs);
  return ring;
}

const seqs = (entries: readonly { seq: number }[] | null) =>
  entries === null ? null : entries.map((entry) => entry.seq);

describe("EventRing", () => {
  it("numbers events and gives every message its id", () => {
    const ring = new EventRing();
    const start = ring.position;
    expect(start).toMatch(/^[A-Za-z0-9_-]{8}:0$/);
    const entry = ring.push(message, 0);
    expect(entry.seq).toBe(1);
    expect(ring.position).toBe(start.replace(/:0$/, ":1"));
    expect(entry.message).toBe(message(ring.position));
  });

  it("replays what came after an id, none after the newest", () => {
    const ring = new EventRing();
    const before = ring.position;
    filled(3, 0, ring);
    expect(seqs(ring.since(before, 3_000))).toEqual([1, 2, 3]);
    const after = before.replace(/:0$/, ":2");
    expect(seqs(ring.since(after, 3_000))).toEqual([3]);
    expect(ring.since(ring.position, 3_000)).toEqual([]);
  });

  it("keeps the last 256 events: an id from before them cannot resume", () => {
    const ring = new EventRing();
    const key = ring.position.split(":")[0] ?? "";
    // 300 events within half a minute: 44 left the ring, whoever saw the 44th gets 45 on.
    filled(300, 0, ring, 100);
    expect(seqs(ring.since(`${key}:44`, 30_000))?.[0]).toBe(45);
    expect(ring.since(`${key}:44`, 30_000)).toHaveLength(256);
    expect(ring.since(`${key}:43`, 30_000)).toBeNull();
  });

  it("keeps two minutes: older events leave, and an id before them cannot resume", () => {
    const ring = new EventRing();
    const key = ring.position.split(":")[0] ?? "";
    ring.push(message, 0);
    ring.push(message, 60_000);
    ring.push(message, 100_000);
    expect(seqs(ring.since(`${key}:0`, 110_000))).toEqual([1, 2, 3]);
    // At 150 s the first is older than two minutes.
    expect(ring.since(`${key}:0`, 150_000)).toBeNull();
    expect(seqs(ring.since(`${key}:1`, 150_000))).toEqual([2, 3]);
    // Long after the newest, nothing to replay — but nothing was missed by whoever saw it.
    expect(ring.since(`${key}:3`, 900_000)).toEqual([]);
    expect(ring.since(`${key}:2`, 900_000)).toBeNull();
  });

  it("keeps its size within the budget, oldest out first", () => {
    const ring = new EventRing({ ...ringLimits, chars: 1_000 });
    for (let index = 0; index < 100; index += 1) ring.push(message, index);
    expect(ring.size).toBeLessThanOrEqual(1_000);
    expect(ring.size).toBeGreaterThan(900);
  });

  it("keeps no event larger than a quarter of the budget: only who saw it can resume", () => {
    const ring = new EventRing({ ...ringLimits, chars: 1_000 });
    const key = ring.position.split(":")[0] ?? "";
    ring.push(message, 0);
    const big = ring.push((id) => `id: ${id}\nevent: days\ndata: ${"x".repeat(400)}\n\n`, 1);
    expect(ring.size).toBe(0);
    expect(ring.since(`${key}:1`, 2)).toBeNull();
    expect(ring.since(`${key}:${big.seq}`, 2)).toEqual([]);
    ring.push(message, 3);
    expect(seqs(ring.since(`${key}:${big.seq}`, 4))).toEqual([3]);
  });

  it("lets no stream resume across an event it skipped", () => {
    const ring = filled(2);
    const key = ring.position.split(":")[0] ?? "";
    ring.skip();
    expect(ring.since(`${key}:2`, 3_000)).toBeNull();
    // From the skipped event on, all is there again.
    const after = ring.position;
    ring.push(message, 3_000);
    expect(seqs(ring.since(after, 3_000))).toEqual([4]);
  });

  it("knows no id of another ring, no future one and no malformed one", () => {
    const ring = filled(3);
    const other = new EventRing();
    expect(ring.since(other.position, 3_000)).toBeNull();
    const key = ring.position.split(":")[0] ?? "";
    for (const id of [`${key}:4`, `${key}:-1`, `${key}:01`, `${key}:1.5`, `${key}:`, key, ""]) {
      expect(ring.since(id, 3_000), id).toBeNull();
    }
  });
});
