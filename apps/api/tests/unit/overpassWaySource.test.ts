import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logging/createLogger";
import { overpassQuery } from "../../src/processing/overpassQuery";
import { OverpassWaySource } from "../../src/processing/overpassWaySource";
import { parseOverpassResponse } from "../../src/processing/parseOverpassResponse";
import { TileFetchError } from "../../src/processing/waySource";

const tile = { z: 14, x: 8360, y: 5482 };

const answer = {
  version: 0.6,
  elements: [
    {
      type: "way",
      id: 20,
      nodes: [1, 2, 3],
      geometry: [
        { lat: 51.05, lon: 3.71 },
        { lat: 51.051, lon: 3.712 },
        { lat: 51.052, lon: 3.714 },
      ],
      tags: { railway: "rail", name: "Line 50", usage: "main", maxspeed: "160" },
    },
    {
      type: "way",
      id: 10,
      nodes: [4, 2],
      geometry: [
        { lat: 51.049, lon: 3.712 },
        { lat: 51.051, lon: 3.712 },
      ],
      tags: { highway: "residential", oneway: "yes", surface: "asphalt" },
    },
    { type: "node", id: 5, lat: 51.0505, lon: 3.711, tags: { railway: "station", name: "Gent" } },
    { type: "node", id: 6, lat: 51.06, lon: 3.72, tags: { highway: "bus_stop" } },
    {
      type: "way",
      id: 30,
      center: { lat: 51.19, lon: 4.46 },
      nodes: [7, 8, 9, 7],
      tags: { aeroway: "aerodrome", name: "Deurne" },
    },
    { type: "node", id: 11, lat: 51.0, lon: 3.7, tags: { amenity: "cafe" } },
  ],
};

const logger = createLogger({ level: "silent" });

/** A fake HTTP client: answers in order, records the requests. */
function fakeFetch(responses: (() => Response)[]) {
  const requests: { url: string; init: RequestInit | undefined; at: number }[] = [];
  let clock = 0;
  const waits: number[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init, at: clock });
    const next = responses.shift();
    if (next === undefined) throw new Error("no more responses");
    return next();
  };
  const source = new OverpassWaySource({
    url: "https://overpass.example/api/interpreter",
    userAgent: "Trail/1.2.3 (+https://trail.example.com)",
    logger,
    fetch: fetch as typeof globalThis.fetch,
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  return { source, requests, waits, tick: (ms: number) => (clock += ms) };
}

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

describe("overpassQuery", () => {
  it("asks for the tile's roads, railways, ferries and stops, with nodes and shapes", () => {
    const query = overpassQuery(tile);
    expect(query).toContain("[out:json][timeout:50]");
    expect(query).toContain(
      'way["highway"]["highway"!~"^(proposed|construction|abandoned|razed|disused|planned)$"]',
    );
    expect(query).toContain(
      'way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|funicular)$"]',
    );
    expect(query).toContain('way["route"="ferry"]');
    expect(query).toContain("out body geom;");
    expect(query).toContain('nwr["aeroway"="aerodrome"]');
    // The tile's bbox: south, west, north, east.
    expect(query).toMatch(/\(51\.\d{7},3\.69\d{5},51\.\d{7},3\.71\d{5}\)/);
  });
});

describe("parseOverpassResponse", () => {
  it("keeps travelled ways with their kept tags and the stops, sorted", () => {
    const data = parseOverpassResponse(JSON.stringify(answer), 1234);
    expect(data.bytes).toBe(1234);
    expect(data.ways.map((way) => [way.id, way.kind])).toEqual([
      [10, "residential"],
      [20, "rail"],
    ]);
    expect(data.ways[1]?.tags).toEqual({ railway: "rail", name: "Line 50", maxspeed: "160" });
    expect(data.ways[1]?.geometry[0]).toEqual([3.71, 51.05]);
    expect(data.pois).toEqual([
      { id: "n5", kind: "station", lat: 51.0505, lon: 3.711, name: "Gent" },
      { id: "n6", kind: "bus_stop", lat: 51.06, lon: 3.72, name: null },
      { id: "w30", kind: "aerodrome", lat: 51.19, lon: 4.46, name: "Deurne" },
    ]);
  });

  it("refuses the whole tile when anything is wrong", () => {
    const refuse = (text: string) =>
      expect(() => parseOverpassResponse(text, 10)).toThrow(TileFetchError);
    refuse("<html>busy</html>");
    refuse(JSON.stringify({ version: 0.6 }));
    refuse(
      JSON.stringify({ ...answer, remark: 'runtime error: Query timed out in "query" at line 3' }),
    );
    refuse(
      JSON.stringify({
        elements: [
          {
            type: "way",
            id: 1,
            nodes: [1, 2, 3],
            geometry: [{ lat: 1, lon: 1 }],
            tags: { highway: "path" },
          },
        ],
      }),
    );
    refuse(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 99, lon: 1 }] }));
    refuse(JSON.stringify({ elements: [{ type: "area", id: 1 }] }));
  });
});

describe("OverpassWaySource", () => {
  it("posts the query politely and parses the answer", async () => {
    const { source, requests } = fakeFetch([json(answer)]);
    const data = await source.fetchTile(tile, new AbortController().signal);
    expect(data.ways).toHaveLength(2);
    const [sent] = requests;
    expect(sent?.url).toBe("https://overpass.example/api/interpreter");
    expect(sent?.init?.method).toBe("POST");
    const headers = new Headers(sent?.init?.headers);
    expect(headers.get("user-agent")).toBe("Trail/1.2.3 (+https://trail.example.com)");
    expect(new URLSearchParams(String(sent?.init?.body)).get("data")).toBe(overpassQuery(tile));
    expect(data.bytes).toBe(JSON.stringify(answer).length);
  });

  it("keeps two seconds between requests and runs one at a time", async () => {
    const { source, requests, waits } = fakeFetch([json(answer), json(answer), json(answer)]);
    const signal = new AbortController().signal;
    await Promise.all([
      source.fetchTile(tile, signal),
      source.fetchTile(tile, signal),
      source.fetchTile(tile, signal),
    ]);
    expect(requests.map((entry) => entry.at)).toEqual([0, 2000, 4000]);
    expect(waits).toEqual([2000, 2000]);
  });

  it("retries busy answers with backoff, honouring Retry-After, and gives up after three", async () => {
    const busy = fakeFetch([json({}, 429, { "retry-after": "30" }), json({}, 504), json(answer)]);
    await busy.source.fetchTile(tile, new AbortController().signal);
    expect(busy.waits).toEqual([30_000, 20_000]);

    const down = fakeFetch([json({}, 503), json({}, 503), json({}, 503)]);
    await expect(down.source.fetchTile(tile, new AbortController().signal)).rejects.toThrow(
      "Overpass answered 503",
    );
    expect(down.requests).toHaveLength(3);
  });

  it("does not repeat a request Overpass refuses outright", async () => {
    const refused = fakeFetch([json({ error: "bad query" }, 400)]);
    await expect(refused.source.fetchTile(tile, new AbortController().signal)).rejects.toThrow(
      "400",
    );
    expect(refused.requests).toHaveLength(1);
  });

  it("refuses an answer over the size cap, counting what was read", async () => {
    const declared = fakeFetch([
      () => new Response("{}", { status: 200, headers: { "content-length": "999999999" } }),
    ]);
    await expect(declared.source.fetchTile(tile, new AbortController().signal)).rejects.toThrow(
      "over the limit",
    );
    const big = "x".repeat(21_000_000);
    const streamed = fakeFetch([() => new Response(big, { status: 200 })]);
    const error = await streamed.source
      .fetchTile(tile, new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TileFetchError);
    expect((error as TileFetchError).bytes).toBeGreaterThan(20_000_000);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const { source } = fakeFetch([json({}, 503), json(answer)]);
    controller.abort();
    await expect(source.fetchTile(tile, controller.signal)).rejects.toThrow();
  });
});
