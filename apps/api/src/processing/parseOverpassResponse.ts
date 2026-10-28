import { z } from "zod";
import { classifyPoi } from "./classifyPoi";
import { classifyWay } from "./classifyWay";
import { keptWayTags } from "./keptWayTags";
import type { OsmPoi } from "./mapData";
import { type FetchedWay, type TileData, TileFetchError } from "./waySource";

/** Sane limits: anything beyond them is not a tile's worth of data. */
const maxElements = 250_000;
const maxNodesPerWay = 10_000;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const osmId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const tagsSchema = z.record(z.string(), z.string()).optional();
const pointSchema = z.object({ lat: latitude, lon: longitude });

const elementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("node"),
    id: osmId,
    lat: latitude,
    lon: longitude,
    tags: tagsSchema,
  }),
  z.object({
    type: z.literal("way"),
    id: osmId,
    nodes: z.array(osmId).max(maxNodesPerWay).optional(),
    geometry: z.array(pointSchema).max(maxNodesPerWay).optional(),
    center: pointSchema.optional(),
    tags: tagsSchema,
  }),
  z.object({
    type: z.literal("relation"),
    id: osmId,
    center: pointSchema.optional(),
    tags: tagsSchema,
  }),
]);

const responseSchema = z.object({
  remark: z.string().optional(),
  elements: z.array(z.unknown()).max(maxElements),
});

/**
 * Strict parsing of an Overpass JSON answer: anything malformed refuses the
 * whole tile (a partial tile would map points onto ways that are missing), and
 * so does a `remark` about a runtime error — Overpass reports a timeout or an
 * out-of-memory abort that way, with whatever it had found until then.
 */
export function parseOverpassResponse(text: string, bytes: number): TileData {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new TileFetchError("Overpass sent something that is not JSON", {
      reason: "not_json",
      bytes,
      cause: error,
    });
  }
  const response = responseSchema.safeParse(json);
  if (!response.success) {
    throw new TileFetchError("Overpass answered without elements", { reason: "malformed", bytes });
  }
  const remark = response.data.remark;
  if (remark !== undefined && /error|timed out|out of memory/i.test(remark)) {
    throw new TileFetchError(`Overpass could not complete the query: ${remark.slice(0, 200)}`, {
      reason: "incomplete",
      bytes,
    });
  }

  const ways = new Map<number, FetchedWay>();
  const pois = new Map<string, OsmPoi>();
  for (const raw of response.data.elements) {
    const parsed = elementSchema.safeParse(raw);
    if (!parsed.success)
      throw new TileFetchError("Overpass sent an element Trail cannot read", {
        reason: "malformed",
        bytes,
      });
    const element = parsed.data;
    const tags = element.tags ?? {};
    if (element.type === "way" && element.geometry !== undefined) {
      const kind = classifyWay(tags);
      const nodes = element.nodes ?? [];
      if (kind === null) continue;
      if (nodes.length !== element.geometry.length || nodes.length < 2) {
        throw new TileFetchError(
          `Way ${element.id} has ${nodes.length} nodes for ${element.geometry.length} positions`,
          { reason: "malformed", bytes },
        );
      }
      const kept: Record<string, string> = {};
      for (const key of keptWayTags) {
        const value = tags[key];
        if (value !== undefined) kept[key] = value;
      }
      ways.set(element.id, {
        id: element.id,
        kind,
        nodes,
        geometry: element.geometry.map((point) => [point.lon, point.lat] as const),
        name: tags["name"] ?? null,
        tags: kept,
      });
      continue;
    }
    const kind = classifyPoi(tags);
    if (kind === null) continue;
    const position = element.type === "node" ? element : element.center;
    if (position === undefined) continue;
    const id = `${element.type.charAt(0)}${element.id}`;
    pois.set(id, { id, kind, lat: position.lat, lon: position.lon, name: tags["name"] ?? null });
  }
  return {
    ways: [...ways.values()].sort((a, b) => a.id - b.id),
    pois: [...pois.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    bytes,
  };
}
