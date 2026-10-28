import type { HeatmapResponse } from "@trail/contracts/heatmap";
import type { TracksResponse } from "@trail/contracts/track";
import type { LevelTracksResponse } from "@trail/contracts/transport";
import type { ZodType } from "zod";
import { type CodecName, policyOf } from "./cachePolicy";
import {
  packHeatCells,
  packLevelPoints,
  packTrackPoints,
  unpackHeatCells,
  unpackLevelPoints,
  unpackTrackPoints,
} from "./pointCodec";

/** Turns an answer into what the store keeps, and back into what its contract checks. */
export interface Codec {
  /** The contract's schema of the answer. */
  schema: ZodType;
  /** The answer with its arrays of numbers packed; the answer itself when absent. */
  pack?: (answer: unknown) => unknown;
  /** The packed answer with its tuples back; null when it is not what `pack` made. */
  unpack?: (body: unknown) => unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The schemas, each loaded when an answer of its kind is first kept or read:
 * the contracts stay in the chunks of the pages that use them, and a public
 * page (sign-in, a shared link) loads none of them for the copy.
 */
const schemas: Record<CodecName, (queryKey: readonly unknown[]) => Promise<ZodType | null>> = {
  config: async () => (await import("@trail/contracts/config")).publicConfigSchema,
  devices: async () => (await import("@trail/contracts/device")).deviceListResponseSchema,
  tracks: async () => (await import("@trail/contracts/track")).tracksResponseSchema,
  "level-tracks": async () =>
    (await import("@trail/contracts/transport")).levelTracksResponseSchema,
  timeline: async () => (await import("../queries/timelineAnswer")).timelineAnswerSchema,
  visits: async () => (await import("@trail/contracts/visit")).visitsResponseSchema,
  trips: async () => (await import("@trail/contracts/trip")).tripsResponseSchema,
  days: async () => (await import("@trail/contracts/stats")).daysResponseSchema,
  heatmap: async () => (await import("@trail/contracts/heatmap")).heatmapResponseSchema,
  insights: async (queryKey) => {
    const insights = await import("@trail/contracts/insights");
    switch (queryKey[1]) {
      case "overview":
        return insights.insightsOverviewSchema;
      case "mode":
        return insights.insightsModeSchema;
      case "time":
        return insights.insightsTimeSchema;
      case "roads":
        return insights.insightsRoadsSchema;
      default:
        return null;
    }
  },
  "device-mode": async () => (await import("@trail/contracts/transport")).deviceModeResponseSchema,
  activity: async () => (await import("@trail/contracts/stats")).activityResponseSchema,
  "ingest-log": async () => (await import("@trail/contracts/ingestLog")).ingestLogResponseSchema,
};

/** Tracks keep their points packed: 48 bytes a point instead of a tuple of six. */
const tracks: Pick<Codec, "pack" | "unpack"> = {
  pack: (answer) => {
    const response = answer as TracksResponse;
    return {
      ...response,
      tracks: response.tracks.map((track) => ({ ...track, points: packTrackPoints(track.points) })),
    };
  },
  unpack: (body) => {
    if (!isRecord(body) || !Array.isArray(body["tracks"])) return null;
    const unpacked: unknown[] = [];
    for (const track of body["tracks"] as unknown[]) {
      if (!isRecord(track)) return null;
      const points = unpackTrackPoints(track["points"]);
      if (points === null) return null;
      unpacked.push({ ...track, points });
    }
    return { ...body, tracks: unpacked };
  },
};

/** Level tracks keep the points of each segment packed. */
const levelTracks: Pick<Codec, "pack" | "unpack"> = {
  pack: (answer) => {
    const response = answer as LevelTracksResponse;
    return {
      ...response,
      segments: response.segments.map((segment) => ({
        ...segment,
        points: packLevelPoints(segment.points),
      })),
    };
  },
  unpack: (body) => {
    if (!isRecord(body) || !Array.isArray(body["segments"])) return null;
    const unpacked: unknown[] = [];
    for (const segment of body["segments"] as unknown[]) {
      if (!isRecord(segment)) return null;
      const points = unpackLevelPoints(segment["points"]);
      if (points === null) return null;
      unpacked.push({ ...segment, points });
    }
    return { ...body, segments: unpacked };
  },
};

/** A heat view keeps its cells packed. */
const heatmap: Pick<Codec, "pack" | "unpack"> = {
  pack: (answer) => {
    const response = answer as HeatmapResponse;
    return { ...response, cells: packHeatCells(response.cells) };
  },
  unpack: (body) => {
    if (!isRecord(body)) return null;
    const cells = unpackHeatCells(body["cells"]);
    return cells === null ? null : { ...body, cells };
  },
};

const packers: Partial<Record<CodecName, Pick<Codec, "pack" | "unpack">>> = {
  tracks,
  "level-tracks": levelTracks,
  heatmap,
};

/** The codec of a query key's answers, or null for a key the policy does not list (or knows no schema of). */
export async function codecFor(queryKey: readonly unknown[]): Promise<Codec | null> {
  const policy = policyOf(queryKey);
  if (policy === null) return null;
  const schema = await schemas[policy.codec](queryKey).catch(() => null);
  return schema === null ? null : { schema, ...packers[policy.codec] };
}
