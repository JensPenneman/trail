import { z } from "zod";
import { MapDataError } from "./mapDataError";

/** Geofabrik's names, as build.sh takes them; short enough for the partitions' table names. */
const regionNamePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const maxRegionNameLength = 31;

/** The files of an artefact the import reads, by their fixed names: never a name from the manifest. */
export const dataFiles = {
  ways: "ways.opl.gz",
  pois: "pois.geojsonseq.gz",
  poly: "region.poly",
} as const;
export type DataFile = keyof typeof dataFiles;

interface DataFileEntry {
  bytes: number;
  sha256: string;
}

/** What the import takes from manifest.json. */
export interface MapManifest {
  region: string;
  /** `yyyymmdd`, the UTC day of the extract. */
  buildId: string;
  extractTimestamp: Date;
  builtAt: Date | null;
  counts: { ways: number; wayNodeRefs: number; poiFeatures: number };
  files: Record<DataFile, DataFileEntry>;
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const manifestSchema = z.object({
  mediaType: z.literal("application/vnd.trail.mapdata.manifest.v1+json"),
  region: z.string().max(100),
  extract: z.object({ timestamp: z.string().max(40).nullable().optional() }).optional(),
  build: z
    .object({ id: z.string().max(40).optional(), at: z.string().max(40).optional() })
    .optional(),
  counts: z
    .object({
      ways: count.optional(),
      wayNodeRefs: count.optional(),
      pois: z.object({ features: count.optional() }).optional(),
    })
    .optional(),
  files: z
    .array(
      z.object({
        name: z.string().max(255),
        bytes: count,
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(256),
});

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function instant(value: string | null | undefined): Date | null {
  if (value === undefined || value === null || !isoInstant.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The parts of manifest.json the import needs (scripts/mapdata/build.sh
 * writes it), checked: a region name, the extract's timestamp, the build id
 * (`build.id`, the extract's UTC day as build.sh names the build), the
 * counts and the three data files with their sizes and SHA-256. The world
 * overview, a basemap only, is refused.
 */
export function readManifest(json: unknown): MapManifest {
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new MapDataError("manifest.json is not a Trail map data manifest");
  const manifest = parsed.data;
  const hasWays = manifest.files.some((file) => file.name === dataFiles.ways);
  if (manifest.region === "world" || !hasWays) {
    throw new MapDataError(
      `${manifest.region === "world" ? "the world overview" : `the artefact of ${manifest.region}`} is a basemap only: it holds no map data to import`,
    );
  }
  if (!regionNamePattern.test(manifest.region) || manifest.region.length > maxRegionNameLength) {
    throw new MapDataError(
      `manifest.json names no region Trail can take: lowercase letters, digits and dashes, at most ${maxRegionNameLength} characters`,
    );
  }
  const extractTimestamp = instant(manifest.extract?.timestamp);
  if (extractTimestamp === null) {
    throw new MapDataError("manifest.json has no extract timestamp (extract.timestamp)");
  }
  const buildId = manifest.build?.id;
  if (buildId === undefined) throw new MapDataError("manifest.json has no build id (build.id)");
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(buildId);
  if (day === null || instant(`${day[1]}-${day[2]}-${day[3]}T00:00:00Z`) === null) {
    throw new MapDataError("manifest.json has a build id that is no day (build.id, yyyymmdd)");
  }
  const ways = manifest.counts?.ways;
  const wayNodeRefs = manifest.counts?.wayNodeRefs;
  const poiFeatures = manifest.counts?.pois?.features;
  if (ways === undefined || wayNodeRefs === undefined || poiFeatures === undefined) {
    throw new MapDataError("manifest.json has no counts of its ways and stops");
  }
  const entry = (name: string): DataFileEntry => {
    const matching = manifest.files.filter((file) => file.name === name);
    const [file] = matching;
    if (file === undefined || matching.length > 1) {
      throw new MapDataError(
        `manifest.json names ${name} ${matching.length > 1 ? "twice" : "not at all"}`,
      );
    }
    return { bytes: file.bytes, sha256: file.sha256 };
  };
  return {
    region: manifest.region,
    buildId,
    extractTimestamp,
    builtAt: instant(manifest.build?.at),
    counts: { ways, wayNodeRefs, poiFeatures },
    files: {
      ways: entry(dataFiles.ways),
      pois: entry(dataFiles.pois),
      poly: entry(dataFiles.poly),
    },
  };
}
