import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cacheStampSchema, type DayStamp, dayStampSchema } from "../src/cacheStamp";
import { serverEventSchema } from "../src/events";
import { dayStatSchema, daysResponseSchema } from "../src/stats";
import { dayStatsResponseSchema, dayStatsSchema } from "../src/statsPublic";
import { type TrackPoint, tracksResponseSchema } from "../src/track";
import { levelTracksResponseSchema, timelineResponseSchema } from "../src/transport";
import { tripsResponseSchema } from "../src/trip";
import { visitsResponseSchema } from "../src/visit";

const car = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
const bike = "0199a0f4-1a2b-7c3d-8e4f-5a6b7c8d9e0f";

const raw = "1840.1792995160000.1793051883000.2.1";
const processed = "37.1793052291000.3.false";

const stamps: DayStamp[] = [
  { deviceId: car, date: "2026-10-25", raw, processed },
  { deviceId: car, date: "2026-10-26", raw: "12.1793049600000.1793050320000.0.0", processed: null },
  { deviceId: bike, date: "2026-10-26", raw, processed },
];

describe("day stamps", () => {
  it("are two opaque strings per device and local day, `processed` null before processing", () => {
    for (const stamp of stamps) expect(dayStampSchema.parse(stamp)).toStrictEqual(stamp);
    const [stamp] = stamps;
    const refused = [
      { ...stamp, raw: "" },
      { ...stamp, processed: "" },
      { ...stamp, processed: undefined },
      { ...stamp, raw: 1840 },
      { ...stamp, deviceId: "car" },
      { ...stamp, date: "2026-02-30" },
      { ...stamp, date: "2026-10-26T00:00:00.000Z" },
    ];
    for (const value of refused) expect(dayStampSchema.safeParse(value).success).toBe(false);
  });

  it("describe every field for the reference, with an example that is a stamp itself", () => {
    for (const schema of [cacheStampSchema, dayStampSchema]) {
      expect(schema.meta()?.description).toBeTruthy();
      const examples = Object.entries(schema.shape).map(([key, field]) => {
        const meta = field.meta();
        expect(meta?.description, key).toBeTruthy();
        expect(meta?.["example"], key).toBeDefined();
        return [key, meta?.["example"]];
      });
      const example = Object.fromEntries(examples);
      expect(schema.parse(example)).toStrictEqual(example);
    }
  });
});

const point = (t: number): TrackPoint => [3.7104, 51.0362, t, null, null, null];

const day = {
  date: "2026-10-26",
  deviceId: car,
  points: 1840,
  distanceM: 23_510,
  firstAt: "2026-10-26T06:12:40.000Z",
  lastAt: "2026-10-26T21:58:03.000Z",
};

/** An answer as the API sends it today, the same answer stamped, and one with a malformed stamp. */
interface Answer {
  name: string;
  /** The contract now. */
  current: z.ZodType;
  /** The contract before stamps, as a page loaded before them (or the API's tests) has it. */
  previous: z.ZodType;
  unstamped: object;
  stamped: object;
  malformed: object;
}

/** A day-sliced answer: `stamps` beside the rest. */
function sliced(
  name: string,
  current: z.ZodObject,
  previous: z.ZodObject,
  unstamped: Record<string, unknown>,
): Answer {
  return {
    name,
    current,
    previous,
    unstamped,
    stamped: { ...unstamped, stamps },
    malformed: { ...unstamped, stamps: [{ ...stamps[0], processed: "" }] },
  };
}

/** The calendar's digest: a `stamp` on every day. */
function digest(name: string, current: z.ZodObject, previous: z.ZodObject): Answer {
  const unstamped = { timezone: "Europe/Brussels", days: [day] };
  return {
    name,
    current,
    previous,
    unstamped,
    stamped: { ...unstamped, days: [{ ...day, stamp: { raw, processed } }] },
    malformed: { ...unstamped, days: [{ ...day, stamp: { raw } }] },
  };
}

const answers: Answer[] = [
  sliced("GET /api/tracks", tracksResponseSchema, tracksResponseSchema.omit({ stamps: true }), {
    from: "2026-10-25T23:00:00.000Z",
    to: "2026-10-26T23:00:00.000Z",
    tracks: [
      {
        deviceId: car,
        total: 2,
        returned: 2,
        simplified: false,
        distanceM: 120,
        firstAt: "2026-10-26T06:12:40.000Z",
        lastAt: "2026-10-26T06:14:40.000Z",
        points: [point(1_792_995_160), point(1_792_995_280)],
      },
    ],
  }),
  sliced(
    "GET /api/v1/tracks",
    levelTracksResponseSchema,
    levelTracksResponseSchema.omit({ stamps: true }),
    {
      level: "inferred",
      availableLevel: "raw",
      from: "2026-10-25T23:00:00.000Z",
      to: "2026-10-26T23:00:00.000Z",
      simplified: false,
      segments: [
        {
          id: null,
          deviceId: car,
          kind: "track",
          level: "raw",
          mode: null,
          modeInferred: null,
          modeUser: null,
          confidence: null,
          needsReview: false,
          startedAt: "2026-10-26T06:12:40.000Z",
          endedAt: "2026-10-26T06:14:40.000Z",
          distanceM: 120,
          centroid: null,
          spreadM: null,
          points: [
            [3.7104, 51.0362, 1_792_995_160],
            [3.7114, 51.0369, 1_792_995_280],
          ],
        },
      ],
    },
  ),
  sliced(
    "GET /api/v1/segments",
    timelineResponseSchema,
    timelineResponseSchema.omit({ stamps: true }),
    {
      items: [
        {
          id: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d4e",
          deviceId: car,
          kind: "stop",
          startedAt: "2026-10-26T06:12:40.000Z",
          endedAt: "2026-10-26T07:02:10.000Z",
          durationS: 2970,
          distanceM: 0,
          mode: null,
          modeInferred: null,
          modeUser: null,
          confidence: null,
          needsReview: false,
          averageSpeed: null,
          maxSpeed: null,
          pointCount: 41,
          start: { lat: 51.0362, lon: 3.7104 },
          end: { lat: 51.0363, lon: 3.7105 },
          centroid: { lat: 51.0362, lon: 3.7104 },
          spreadM: 20,
        },
      ],
      nextCursor: null,
      pending: false,
    },
  ),
  sliced("GET /api/visits", visitsResponseSchema, visitsResponseSchema.omit({ stamps: true }), {
    visits: [
      {
        deviceId: car,
        recordedAt: "2026-10-26T12:31:02.000Z",
        arrivedAt: "2026-10-26T08:58:40.000Z",
        departedAt: "2026-10-26T12:30:11.000Z",
        lat: 51.0543,
        lon: 3.7174,
        accuracy: 35,
      },
    ],
  }),
  sliced("GET /api/trips", tripsResponseSchema, tripsResponseSchema.omit({ stamps: true }), {
    trips: [
      {
        deviceId: bike,
        startedAt: "2026-10-26T07:02:10.000Z",
        endedAt: "2026-10-26T07:41:55.000Z",
        mode: "bicycle",
        distanceM: 12_480,
        durationS: 2385,
        steps: null,
        stoppedAutomatically: false,
      },
    ],
  }),
  digest(
    "GET /api/stats/days",
    daysResponseSchema,
    daysResponseSchema.extend({ days: z.array(dayStatSchema.omit({ stamp: true })) }),
  ),
  digest(
    "GET /api/v1/stats/days",
    dayStatsResponseSchema,
    dayStatsResponseSchema.extend({ days: z.array(dayStatsSchema.omit({ stamp: true })) }),
  ),
];

describe.each(answers)("$name", ({ current, previous, unstamped, stamped, malformed }) => {
  it("parses an answer without stamps as before, adding nothing", () => {
    expect(current.parse(unstamped)).toStrictEqual(unstamped);
  });

  it("keeps the stamps of a stamped answer, and refuses a malformed one", () => {
    expect(current.parse(stamped)).toStrictEqual(stamped);
    expect(current.safeParse(malformed).success).toBe(false);
  });

  it("reads a stamped answer as before on the previous contract: zod strips the stamps", () => {
    expect(previous.parse(stamped)).toStrictEqual(unstamped);
  });
});

/** What the web app's `parseServerEvent` makes of a message's `data:`: the event, or null. */
function parseServerEventWith(schema: z.ZodType, event: unknown): unknown {
  const parsed = schema.safeParse(JSON.parse(JSON.stringify(event)));
  return parsed.success ? parsed.data : null;
}

const versions = { averaged: 1, mapped: 1, inferred: 3 };
const hello = { type: "hello", serverTime: "2026-10-26T09:00:00.000Z" };
const days = { type: "days", deviceId: car, days: stamps.slice(0, 2) };
const resync = { type: "resync" };

describe("server events", () => {
  it("tell a stream the stamps of days summed up again, and when to resync", () => {
    expect(parseServerEventWith(serverEventSchema, days)).toStrictEqual(days);
    expect(parseServerEventWith(serverEventSchema, resync)).toStrictEqual(resync);
    const malformed = { ...days, days: [{ ...stamps[0], raw: "" }] };
    expect(parseServerEventWith(serverEventSchema, malformed)).toBeNull();
    expect(parseServerEventWith(serverEventSchema, { ...days, deviceId: "car" })).toBeNull();
  });

  it("say hello with the processing versions, or without them as before", () => {
    expect(parseServerEventWith(serverEventSchema, hello)).toStrictEqual(hello);
    expect(parseServerEventWith(serverEventSchema, { ...hello, versions })).toStrictEqual({
      ...hello,
      versions,
    });
    // A level a later release adds is dropped, not refused.
    expect(
      parseServerEventWith(serverEventSchema, { ...hello, versions: { ...versions, smoothed: 1 } }),
    ).toStrictEqual({ ...hello, versions });
    for (const wrong of [
      { averaged: 1, mapped: 1 },
      { ...versions, inferred: 0 },
      { ...versions, mapped: 1.5 },
      { ...versions, averaged: "1" },
    ]) {
      expect(parseServerEventWith(serverEventSchema, { ...hello, versions: wrong })).toBeNull();
    }
  });

  it("are ignored by a page loaded before them: parseServerEvent answers null", () => {
    // The contract before this change: `hello` without `versions`, no `days`, no `resync`.
    const [currentHello, ...others] = serverEventSchema.options;
    const previous = z.discriminatedUnion("type", [
      currentHello.omit({ versions: true }),
      ...others.filter((option) => !["days", "resync"].includes(option.shape.type.value)),
    ]);
    expect(previous.options).toHaveLength(serverEventSchema.options.length - 2);
    expect(parseServerEventWith(previous, days)).toBeNull();
    expect(parseServerEventWith(previous, resync)).toBeNull();
    expect(parseServerEventWith(previous, { ...hello, versions })).toStrictEqual(hello);
  });
});
