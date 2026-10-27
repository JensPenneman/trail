import { randomBytes } from "node:crypto";
import { BlockList, isIPv4 } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userAgentFamily } from "../../src/auth/userAgentLabel";
import type { AccessRecord } from "../../src/dataAccess/accessRecord";
import type { AccessStore } from "../../src/dataAccess/accessStore";
import { canonicalResource } from "../../src/dataAccess/canonicalResource";
import { coarseNetwork } from "../../src/dataAccess/coarseNetwork";
import {
  type DataAccessOptions,
  DataAccessRecorder,
} from "../../src/dataAccess/dataAccessRecorder";
import { dedupeKey } from "../../src/dataAccess/dedupeKey";
import { inputResource } from "../../src/dataAccess/inputResource";
import type { AccessRow } from "../../src/dataAccess/insertAccessRows";
import { visitorKey } from "../../src/dataAccess/visitorKey";
import { createLogger } from "../../src/logging/createLogger";
import { accessPathId } from "../../src/v1/accessPathId";
import { v1Routes } from "../../src/v1/v1Routes";

const owner = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60";
const otherOwner = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a61";
const person = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a62";
const share = "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23";
const link = "019a2b4f-0c33-7a51-8d4e-6b7f1c2d3e4f";
const token = "019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b";
const phone = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
const watch = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd4";
const session = "a".repeat(64);
const secret = Buffer.alloc(32, 9);

/** A refusal as pg reports it: SQLSTATE 23514, a check constraint. */
const checkViolation = () =>
  Object.assign(new Error("violates check constraint"), { code: "23514" });
/** The database going away: a connection refused. */
const unavailable = () =>
  Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

/** The table, in memory: every write, and failures to hand out first. */
class MemoryStore implements AccessStore {
  readonly writes: AccessRow[][] = [];
  readonly failures: unknown[] = [];
  refuse: (row: AccessRow) => boolean = () => false;

  async insert(rows: readonly AccessRow[]): Promise<void> {
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    if (rows.some((row) => this.refuse(row))) throw checkViolation();
    this.writes.push([...rows]);
  }

  async visitorSecret(): Promise<Buffer> {
    return secret;
  }

  get rows(): AccessRow[] {
    return this.writes.flat();
  }
}

const quiet = createLogger({ level: "silent" });

function recorder(options: DataAccessOptions = {}) {
  const store = new MemoryStore();
  // Writes only when a test flushes: no timer gets in the way.
  return {
    store,
    log: new DataAccessRecorder(store, quiet, { flushIntervalMs: 3_600_000, ...options }),
  };
}

const at = new Date("2026-10-26T18:20:00.000Z");
const minutes = (count: number) => new Date(at.getTime() + count * 60_000);

const ownRead = (changes: Partial<AccessRecord> = {}): AccessRecord =>
  ({
    ownerUserId: owner,
    channel: "web",
    actor: { kind: "owner", sessionId: session, label: "Safari on iPhone" },
    action: "dashboard.tracks",
    access: "read",
    resource: {
      deviceIds: [phone],
      from: "2026-10-26T00:00:00.000Z",
      to: "2026-10-27T00:00:00.000Z",
    },
    status: 200,
    at,
    ...changes,
  }) as AccessRecord;

const personLook = (changes: Partial<AccessRecord> = {}): AccessRecord =>
  ({
    ownerUserId: owner,
    channel: "people",
    actor: { kind: "person", userId: person, shareId: share, label: "Ana" },
    action: "listPeople",
    access: "read",
    resource: { deviceIds: [phone], precision: "approximate" },
    status: 200,
    at,
    ...changes,
  }) as AccessRecord;

const linkView = (ipCoarse: string, uaFamily = "iPhone · Safari"): AccessRecord => ({
  ownerUserId: owner,
  channel: "link",
  actor: { kind: "link", linkId: link, label: "On the way home", visitor: { ipCoarse, uaFamily } },
  action: "link.view",
  access: "read",
  resource: { precision: "precise" },
  status: 200,
  at,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the data access recorder", () => {
  it("counts the same access in one row per hour, with its first and last time", async () => {
    const { store, log } = recorder();
    log.record(ownRead({ at: minutes(0) }));
    log.record(ownRead({ at: minutes(30) }));
    log.record(ownRead({ at: minutes(-5) }));
    await log.flush();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      ownerUserId: owner,
      bucketStart: new Date("2026-10-26T18:00:00.000Z"),
      firstAt: minutes(-5),
      lastAt: minutes(30),
      count: 3,
      actorKind: "owner",
      channel: "web",
      actorSessionId: session,
      actorLabel: "Safari on iPhone",
      action: "dashboard.tracks",
    });
    expect(store.rows[0]?.dedupeKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("keeps hours, actors, actions, kinds and resources apart", async () => {
    const { store, log } = recorder();
    log.record(ownRead());
    log.record(ownRead({ at: minutes(45) }));
    log.record(
      ownRead({ actor: { kind: "owner", sessionId: "b".repeat(64), label: "Firefox on Mac" } }),
    );
    log.record(ownRead({ action: "dashboard.visits" }));
    log.record(ownRead({ access: "export" }));
    log.record(ownRead({ resource: { deviceIds: [watch] } }));
    log.record(ownRead({ ownerUserId: otherOwner }));
    await log.flush();
    expect(store.rows).toHaveLength(7);
    expect(store.rows.every((row) => row.count === 1)).toBe(true);
  });

  it("compares resources as data: keys and devices in order, unknown keys and coordinates gone", async () => {
    const { store, log } = recorder();
    log.record(ownRead({ resource: { deviceIds: [watch, phone], level: "raw" } }));
    log.record(
      ownRead({
        // Whatever a bug might put in: no key outside the contract survives.
        resource: {
          level: "raw",
          deviceIds: [phone, watch, phone],
          bbox: [3.7, 51, 3.8, 51.1],
          lat: 51.05,
        } as never,
      }),
    );
    await log.flush();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.count).toBe(2);
    expect(store.rows[0]?.resource).toEqual({ deviceIds: [phone, watch], level: "raw" });
    expect(JSON.stringify(store.rows)).not.toMatch(/bbox|51\.05|"lat"/);
  });

  it("writes two seconds after the first access, and at once when 500 rows wait", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    // Distinct reads of one actor fold after 50 (200 across actions): these must stay 500 rows.
    const log = new DataAccessRecorder(store, quiet, { foldAfter: 1_000, rowsPerActor: 1_000 });
    log.record(ownRead());
    await vi.advanceTimersByTimeAsync(1_900);
    expect(store.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(store.writes).toHaveLength(1);

    for (let index = 0; index < 500; index += 1) {
      log.record(ownRead({ resource: { hours: index + 1 } }));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writes).toHaveLength(2);
    expect(store.writes[1]).toHaveLength(500);
    log.stop();
  });

  it("writes a long batch in statements of 500 rows", async () => {
    const { store, log } = recorder({
      batchSize: 500,
      foldAfter: 2_000,
      rowsPerActor: 2_000,
      maxPending: 2_000,
    });
    vi.useFakeTimers();
    for (let index = 0; index < 1_200; index += 1) {
      log.record(ownRead({ resource: { hours: index + 1 } }));
    }
    await log.flush();
    expect(store.writes.map((rows) => rows.length)).toEqual([500, 500, 200]);
  });

  it("tries a failed write again with the next, at most three times", async () => {
    const { store, log } = recorder();
    store.failures.push(unavailable(), unavailable());
    log.record(ownRead());
    await log.flush();
    await log.flush();
    expect(store.rows).toHaveLength(0);
    log.record(ownRead({ at: minutes(1) }));
    await log.flush();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.count).toBe(2);

    store.failures.push(unavailable(), unavailable(), unavailable());
    log.record(personLook());
    await log.flush();
    await log.flush();
    await log.flush();
    await log.flush();
    expect(store.rows).toHaveLength(1);
  });

  it("leaves out only a row the database refuses, never the others with it", async () => {
    const { store, log } = recorder();
    store.refuse = (row) => row.action === "broken";
    log.record(ownRead());
    log.record(ownRead({ action: "broken" }));
    log.record(personLook());
    await log.flush();
    expect(store.rows.map((row) => row.action).sort()).toEqual(["dashboard.tracks", "listPeople"]);
  });

  it("never throws, and records nothing with a malformed id", async () => {
    const { store, log } = recorder();
    expect(() => log.record(ownRead({ ownerUserId: "not-a-uuid" }))).not.toThrow();
    expect(() =>
      log.record(ownRead({ actor: { kind: "owner", sessionId: "short", label: "x" } })),
    ).not.toThrow();
    expect(() =>
      log.record(
        personLook({ actor: { kind: "person", userId: person, shareId: "nope", label: "Ana" } }),
      ),
    ).not.toThrow();
    await log.flush();
    expect(store.rows).toHaveLength(0);
  });

  it("keeps at most so many rows waiting while the database is away", async () => {
    const { store, log } = recorder({ maxPending: 3, foldAfter: 100 });
    for (let index = 0; index < 10; index += 1)
      log.record(ownRead({ resource: { hours: index + 1 } }));
    await log.flush();
    expect(store.rows).toHaveLength(3);
  });

  it("folds an actor's distinct accesses of one action beyond the limit into one row", async () => {
    const { store, log } = recorder({ foldAfter: 3 });
    for (let index = 0; index < 6; index += 1)
      log.record(ownRead({ resource: { hours: index + 1 } }));
    log.record(ownRead({ resource: { hours: 1 } }));
    // Another action of the same actor has a limit of its own.
    log.record(ownRead({ action: "dashboard.visits", resource: { hours: 9 } }));
    await log.flush();
    const tracks = store.rows.filter((row) => row.action === "dashboard.tracks");
    expect(tracks).toHaveLength(4);
    expect(tracks.find((row) => row.resource.folded === true)).toMatchObject({
      count: 3,
      resource: { folded: true },
    });
    expect(tracks.find((row) => row.resource.hours === 1)?.count).toBe(2);
    expect(store.rows.filter((row) => row.action === "dashboard.visits")).toHaveLength(1);
  });

  it("keeps the devices on a folded row", async () => {
    const { store, log } = recorder({ foldAfter: 1 });
    log.record(ownRead({ resource: { deviceIds: [phone], hours: 1 } }));
    log.record(ownRead({ resource: { deviceIds: [phone], hours: 2 } }));
    log.record(ownRead({ resource: { deviceIds: [watch], hours: 3 } }));
    await log.flush();
    expect(store.rows.map((row) => row.resource)).toEqual([
      { deviceIds: [phone], hours: 1 },
      { deviceIds: [phone], folded: true },
      { deviceIds: [watch], folded: true },
    ]);
  });

  it("folds an actor's distinct accesses across actions beyond the limit of the actor", async () => {
    const { store, log } = recorder({ foldAfter: 100, rowsPerActor: 3 });
    for (const action of ["dashboard.tracks", "dashboard.visits", "dashboard.trips"]) {
      log.record(ownRead({ action, resource: { hours: 1 } }));
    }
    log.record(ownRead({ action: "dashboard.heatmap", resource: { hours: 1 } }));
    log.record(ownRead({ action: "dashboard.heatmap", resource: { hours: 2 } }));
    log.record(ownRead({ action: "dashboard.export", resource: { hours: 1 } }));
    // Someone else has a limit of their own.
    log.record(personLook());
    await log.flush();
    const own = store.rows.filter((row) => row.actorKind === "owner");
    expect(own.filter((row) => row.resource.folded !== true)).toHaveLength(3);
    expect(
      own.filter((row) => row.resource.folded === true).map((row) => [row.action, row.count]),
    ).toEqual([
      ["dashboard.heatmap", 2],
      ["dashboard.export", 1],
    ]);
    expect(store.rows.filter((row) => row.actorKind === "person")).toHaveLength(1);
  });

  it("bounds what it remembers of an hour: past the limit every new access folds", async () => {
    const { store, log } = recorder({ maxRegistered: 2 });
    log.record(ownRead({ resource: { hours: 1 } }));
    log.record(ownRead({ resource: { hours: 2 } }));
    log.record(ownRead({ resource: { hours: 3 } }));
    log.record(ownRead({ resource: { hours: 1 } }));
    await log.flush();
    expect(store.rows.map((row) => [row.resource, row.count])).toEqual([
      [{ hours: 1 }, 2],
      [{ hours: 2 }, 1],
      [{ folded: true }, 1],
    ]);
  });

  it("starts the limits again with every hour", async () => {
    const { store, log } = recorder({ foldAfter: 1 });
    log.record(ownRead({ resource: { hours: 1 } }));
    log.record(ownRead({ resource: { hours: 2 } }));
    log.record(ownRead({ resource: { hours: 2 }, at: minutes(60) }));
    await log.flush();
    expect(store.rows.map((row) => row.resource)).toEqual([
      { hours: 1 },
      { folded: true },
      { hours: 2 },
    ]);
  });

  it("counts a link's visitors beyond the limit together, without their network", async () => {
    const { store, log } = recorder({ visitorsPerLink: 2 });
    for (const network of ["81.82.83.0/24", "81.82.84.0/24", "81.82.85.0/24", "81.82.86.0/24"]) {
      log.record(linkView(network));
    }
    log.record(linkView("81.82.83.0/24"));
    await log.flush();
    expect(store.rows).toHaveLength(3);
    const together = store.rows.find((row) => row.visitorKey === null);
    expect(together).toMatchObject({
      count: 2,
      ipCoarse: null,
      uaFamily: null,
      resource: { folded: true },
    });
    const first = store.rows.find((row) => row.ipCoarse === "81.82.83.0/24");
    expect(first?.count).toBe(2);
    expect(first?.visitorKey).toBe(
      visitorKey(secret, owner, { ipCoarse: "81.82.83.0/24", uaFamily: "iPhone · Safari" }),
    );
  });

  it("counts a link's visitors by their network: other browsers of one network are no new visitors", async () => {
    const { store, log } = recorder({ visitorsPerLink: 2 });
    log.record(linkView("81.82.83.0/24", "iPhone · Safari"));
    log.record(linkView("81.82.83.0/24", "Mac · Firefox"));
    log.record(linkView("81.82.84.0/24", "iPhone · Safari"));
    log.record(linkView("81.82.85.0/24", "iPhone · Safari"));
    await log.flush();
    expect(store.rows.map((row) => [row.ipCoarse, row.uaFamily])).toEqual([
      ["81.82.83.0/24", "iPhone · Safari"],
      ["81.82.83.0/24", "Mac · Firefox"],
      ["81.82.84.0/24", "iPhone · Safari"],
      [null, null],
    ]);
  });

  it("keeps a person and their share, never their own credentials", async () => {
    const { store, log } = recorder();
    log.record(personLook());
    log.record(personLook({ channel: "live", action: "live.position" }));
    await log.flush();
    for (const row of store.rows) {
      expect(row).toMatchObject({
        actorKind: "person",
        actorUserId: person,
        actorShareId: share,
        actorSessionId: null,
        actorTokenId: null,
        actorLinkId: null,
        visitorKey: null,
        ipCoarse: null,
        uaFamily: null,
      });
    }
  });

  it("cleans and cuts the names it keeps", async () => {
    const { store, log } = recorder();
    log.record(
      personLook({
        actor: {
          kind: "person",
          userId: person,
          shareId: share,
          label: `Ana${String.fromCodePoint(0x202e, 0x7)} ${"x".repeat(200)}`,
        },
      }),
    );
    await log.flush();
    const label = store.rows[0]?.actorLabel ?? "";
    // No control or format character (a bidirectional override, a bell) is left.
    expect(/[\p{Cc}\p{Cf}]/u.test(label)).toBe(false);
    expect([...label].length).toBeLessThanOrEqual(80);
    expect(label.startsWith("Ana")).toBe(true);
  });

  it("takes no accesses once stopped", async () => {
    const { store, log } = recorder();
    log.stop();
    log.record(ownRead());
    await log.flush();
    expect(store.rows).toHaveLength(0);
  });
});

describe("the dedupe key", () => {
  const base = {
    actor: { kind: "token" as const, tokenId: token, label: "Home Assistant" },
    channel: "api",
    action: "getTracks",
    access: "read",
    resource: { level: "raw" as const },
  };

  it("is the same for the same access, whatever the actor is called", () => {
    expect(dedupeKey(base)).toBe(
      dedupeKey({ ...base, actor: { ...base.actor, label: "Renamed" } }),
    );
    expect(dedupeKey(base)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("differs by actor, channel, action, kind and resource", () => {
    const keys = new Set([
      dedupeKey(base),
      dedupeKey({ ...base, actor: { ...base.actor, tokenId: phone } }),
      dedupeKey({ ...base, channel: "mcp" }),
      dedupeKey({ ...base, action: "listSegments" }),
      dedupeKey({ ...base, access: "write" }),
      dedupeKey({ ...base, resource: { level: "inferred" } }),
    ]);
    expect(keys.size).toBe(6);
  });
});

describe("a visitor's network", () => {
  it("keeps the /24 of an IPv4 address and the /48 of an IPv6 one", () => {
    expect(coarseNetwork("81.82.83.84")).toBe("81.82.83.0/24");
    expect(coarseNetwork("10.0.0.1")).toBe("10.0.0.0/24");
    expect(coarseNetwork("2001:db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:db8:1234::/48");
    expect(coarseNetwork("2001:DB8:ABCD:12::1")).toBe("2001:db8:abcd::/48");
    expect(coarseNetwork("2001:db8::1")).toBe("2001:db8::/48");
    expect(coarseNetwork("2001:0:1:2::")).toBe("2001:0:1::/48");
    expect(coarseNetwork("::1")).toBe("::/48");
    expect(coarseNetwork("::")).toBe("::/48");
    expect(coarseNetwork("64:ff9b::81.82.83.84")).toBe("64:ff9b::/48");
  });

  it("reads a 6to4 address as the IPv4 address it carries: its /48 would be that address", () => {
    expect(coarseNetwork("2002:5152:5354::1")).toBe("81.82.83.0/24");
    expect(coarseNetwork("2002:c000:0204:1:2:3:4:5")).toBe("192.0.2.0/24");
    expect(coarseNetwork("2002::")).toBe("0.0.0.0/24");
  });

  it("reads an IPv4-mapped address as IPv4, and drops a zone", () => {
    expect(coarseNetwork("::ffff:81.82.83.84")).toBe("81.82.83.0/24");
    expect(coarseNetwork("::FFFF:192.168.1.20")).toBe("192.168.1.0/24");
    expect(coarseNetwork("fe80::1%en0")).toBe("fe80::/48");
  });

  it("is null for anything that is not an address", () => {
    for (const value of [
      null,
      undefined,
      "",
      "localhost",
      "81.82.83",
      "1.2.3.4.5",
      "::g",
      "2001:db8::/48",
    ]) {
      expect(coarseNetwork(value)).toBeNull();
    }
  });

  it("always holds the address it came from, and nothing more precise than its prefix", () => {
    for (let index = 0; index < 300; index += 1) {
      const bytes = randomBytes(16);
      const address =
        index % 2 === 0
          ? [...bytes.subarray(0, 4)].join(".")
          : Array.from({ length: 8 }, (_, group) =>
              bytes.readUInt16BE(group * 2).toString(16),
            ).join(":");
      // A 6to4 address (2002::/16) answers with the IPv4 network it carries: tested above.
      if (address.startsWith("2002:")) continue;
      const network = coarseNetwork(address);
      expect(network).not.toBeNull();
      const [base = "", prefix = ""] = (network ?? "").split("/");
      const family = isIPv4(address) ? "ipv4" : "ipv6";
      expect(Number(prefix)).toBe(family === "ipv4" ? 24 : 48);
      const list = new BlockList();
      list.addSubnet(base, Number(prefix), family);
      expect(list.check(address, family)).toBe(true);
      // The base has no host bits: masking it again changes nothing.
      expect(coarseNetwork(base)).toBe(network);
    }
  });
});

describe("a visitor's kind of browser", () => {
  it("names the device and the browser, nothing else of the user agent", () => {
    expect(
      userAgentFamily(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      userAgentFamily(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:143.0) Gecko/20100101 Firefox/143.0",
      ),
    ).toBe("Mac · Firefox");
    expect(
      userAgentFamily(
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
      ),
    ).toBe("Android · Chrome");
    expect(userAgentFamily("curl/8.10.1")).toBe("Unknown browser");
    expect(userAgentFamily(null)).toBe("Unknown browser");
  });
});

describe("a visitor's key", () => {
  const visitor = { ipCoarse: "81.82.83.0/24", uaFamily: "iPhone · Safari" };

  it("is the same for the same visitor of the same owner, and 16 hex digits", () => {
    expect(visitorKey(secret, owner, visitor)).toBe(visitorKey(secret, owner, { ...visitor }));
    expect(visitorKey(secret, owner, visitor)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs by owner, network, browser and server key", () => {
    const keys = new Set([
      visitorKey(secret, owner, visitor),
      visitorKey(secret, otherOwner, visitor),
      visitorKey(secret, owner, { ...visitor, ipCoarse: "81.82.84.0/24" }),
      visitorKey(secret, owner, { ...visitor, uaFamily: "Mac · Safari" }),
      visitorKey(Buffer.alloc(32, 1), owner, visitor),
      visitorKey(secret, owner, { ...visitor, ipCoarse: null }),
    ]);
    expect(keys.size).toBe(6);
  });

  it("holds no more than the network: two addresses of one /24 are one visitor", () => {
    const first = coarseNetwork("81.82.83.4");
    const second = coarseNetwork("81.82.83.250");
    expect(first).toBe(second);
    expect(visitorKey(secret, owner, { ipCoarse: first, uaFamily: "iPhone · Safari" })).toBe(
      visitorKey(secret, owner, { ipCoarse: second, uaFamily: "iPhone · Safari" }),
    );
  });

  it("cannot be made without the server's key", () => {
    // Anyone may try every /24 and browser; without the key, the keys they get are others.
    const guessed = visitorKey(Buffer.alloc(32), owner, visitor);
    expect(guessed).not.toBe(visitorKey(secret, owner, visitor));
    expect(visitorKey(secret, owner, visitor)).not.toContain("81");
  });
});

describe("resources", () => {
  it("take what the validated input names, in the log's words", () => {
    expect(
      inputResource(
        [
          { id: phone },
          {
            from: "2026-10-25T00:00:00+02:00",
            to: "2026-10-26T00:00:00Z",
            devices: [watch],
            level: "inferred",
            cursor: "abc",
            limit: 500,
          },
        ],
        "device",
      ),
    ).toEqual({
      deviceIds: [phone, watch],
      from: "2026-10-24T22:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
      level: "inferred",
    });
    expect(inputResource([{ from: "2026-10-01", to: "2026-10-31", deviceIds: [phone] }])).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      deviceIds: [phone],
    });
    expect(inputResource([{ id: share }, { mode: null }], "share")).toEqual({
      shareId: share,
      mode: null,
    });
    expect(inputResource([{ id: link }], "link")).toEqual({ linkId: link });
    expect(inputResource([{ id: phone }], "segment")).toEqual({ segmentId: phone });
    expect(inputResource([{ deviceId: phone, hours: 48, format: "gpx" }])).toEqual({
      deviceIds: [phone],
      hours: 48,
      format: "gpx",
    });
  });

  it("never take a viewport, a name or anything else", () => {
    expect(
      inputResource([
        {
          bbox: [3.7, 51, 3.8, 51.1],
          zoom: 12,
          name: "Home",
          email: "ana@example.com",
          label: "Hi",
        },
        { lat: 51.05, lon: 3.72, maxPoints: 8000, maxAccuracy: 200, until: "2026-10-26T20:00:00Z" },
      ]),
    ).toEqual({});
  });

  it("are refused when a value is not what the contract allows", () => {
    expect(canonicalResource({ deviceIds: ["not-a-device"] })).toBeNull();
    expect(canonicalResource({ level: "precise" } as never)).toBeNull();
    expect(canonicalResource({ from: "yesterday" })).toBeNull();
    expect(canonicalResource({ mode: null, historyDays: null })).toEqual({
      historyDays: null,
      mode: null,
    });
  });
});

describe("the {id} of v1 paths", () => {
  it("means a device, a segment, a share or a link on every route that has one", () => {
    const routes = v1Routes(() => {
      throw new Error("not served here");
    });
    const withId = routes.filter((route) => route.spec.path.includes("{id}"));
    expect(withId.length).toBeGreaterThan(5);
    for (const route of withId) {
      expect(accessPathId(route.spec.path), route.spec.path).not.toBeNull();
    }
    expect(accessPathId("/api/v1/devices/{id}/mode")).toBe("device");
    expect(accessPathId("/api/v1/segments/{id}/mode")).toBe("segment");
    expect(accessPathId("/api/v1/shares/incoming/{id}/hide")).toBe("share");
    expect(accessPathId("/api/v1/shares/{id}/confirm")).toBe("share");
    expect(accessPathId("/api/v1/share-links/{id}")).toBe("link");
    expect(accessPathId("/api/v1/people/{userId}/track")).toBeNull();
  });
});
