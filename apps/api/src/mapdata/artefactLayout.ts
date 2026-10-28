import { z } from "zod";
import { worldRegion } from "./regionName";
import { ociManifestMediaType, type ResolvedManifest } from "./registry";
import { RegistryError } from "./registryError";

/** The `artifactType` of every map data artefact (`oras push --artifact-type`). */
export const artefactType = "application/vnd.trail.mapdata.v1";
/** The annotations `scripts/mapdata/publish.sh` puts on the manifest. */
export const regionAnnotation = "com.jenspenneman.trail.mapdata.region";
export const buildAnnotation = "com.jenspenneman.trail.mapdata.build";
/** ORAS names each layer's file in this annotation. */
const titleAnnotation = "org.opencontainers.image.title";

/** The files of an artefact and their media types (docs/design/self-hosted-maps.md §4.2); nothing else is written. */
export const artefactFiles = {
  "manifest.json": "application/vnd.trail.mapdata.manifest.v1+json",
  "region.poly": "application/vnd.trail.mapdata.poly.v1",
  "ways.opl.gz": "application/vnd.trail.mapdata.ways.v1+gzip",
  "pois.geojsonseq.gz": "application/vnd.trail.mapdata.pois.v1+gzip",
  "basemap.pmtiles": "application/vnd.trail.mapdata.basemap.v1",
} as const satisfies Record<string, string>;

type ArtefactFileName = keyof typeof artefactFiles;

const isArtefactFile = (name: string): name is ArtefactFileName =>
  Object.hasOwn(artefactFiles, name);

/** What a region's import needs, and what the world overview consists of. */
const requiredFiles = {
  region: ["manifest.json", "ways.opl.gz", "pois.geojsonseq.gz", "region.poly"],
  world: ["manifest.json", "basemap.pmtiles"],
} as const satisfies Record<string, readonly ArtefactFileName[]>;

/** Small files are never split, and a manifest or polygon this large is not one Trail built. */
const maxWholeBytes: Partial<Record<ArtefactFileName, number>> = {
  "manifest.json": 1024 * 1024,
  "region.poly": 16 * 1024 * 1024,
};
const maxLayers = 256;

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const annotationsSchema = z.record(z.string().max(256), z.string().max(4096));
const descriptorSchema = z.object({
  mediaType: z.string().min(1).max(255),
  digest: digestSchema,
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  annotations: annotationsSchema.optional(),
});

const ociManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.literal(ociManifestMediaType),
  artifactType: z.literal(artefactType),
  config: descriptorSchema,
  layers: z.array(descriptorSchema).min(1).max(maxLayers),
  annotations: annotationsSchema.optional(),
});

/** A layer of the artefact: one blob, by digest and size. */
export interface Layer {
  digest: string;
  size: number;
}

/** A file of the build, as one layer or as chunks in order. */
interface PlannedFile {
  name: ArtefactFileName;
  mediaType: string;
  layers: Layer[];
  bytes: number;
}

/** What a build consists of, checked before anything is downloaded. */
export interface ArtefactLayout {
  region: string;
  /** `yyyymmdd`, the extract's date (for people; the digest identifies the build). */
  buildId: string;
  digest: string;
  manifest: Layer;
  /** The other files, manifest.json not among them. */
  files: PlannedFile[];
  /** Every layer together. */
  totalBytes: number;
}

const malformed = (message: string): RegistryError =>
  new RegistryError(message, { reason: "malformed" });

/** `yyyymmdd` of a real day. */
export function isBuildId(value: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** `ways.opl.gz` → the whole file; `ways.opl.gz.003` → its fourth chunk. */
function parseTitle(title: string): { name: ArtefactFileName; chunk: number | null } | null {
  if (isArtefactFile(title)) return { name: title, chunk: null };
  const match = /^(.+)\.(\d{3})$/.exec(title);
  const base = match?.[1];
  if (match === null || base === undefined || !isArtefactFile(base)) return null;
  return { name: base, chunk: Number(match[2]) };
}

/**
 * Checks the manifest the registry resolved for `region` before a byte of
 * the build is fetched (docs/design/self-hosted-maps.md §4.3, §7): a Trail
 * map data artefact of that region, whose layers are the known files —
 * never a name from the manifest that could leave the build's directory —
 * whole or in consecutive chunks, the files the build needs present, and
 * no more bytes in all than `maxBytes`.
 */
export function readArtefactLayout(
  resolved: ResolvedManifest,
  region: string,
  maxBytes: number,
): ArtefactLayout {
  const parsed = ociManifestSchema.safeParse(resolved.json);
  if (!parsed.success) {
    throw malformed(`the manifest of ${region} is not a Trail map data artefact`);
  }
  const manifest = parsed.data;
  const annotated = manifest.annotations?.[regionAnnotation];
  if (annotated !== region) {
    throw malformed(
      `the manifest of ${region} names the region ${JSON.stringify(annotated ?? null)}`,
    );
  }
  const buildId = manifest.annotations?.[buildAnnotation] ?? "";
  if (!isBuildId(buildId)) {
    throw malformed(`the manifest of ${region} has no build id (yyyymmdd)`);
  }

  const groups = new Map<ArtefactFileName, { whole: Layer[]; chunks: Map<number, Layer> }>();
  let totalBytes = 0;
  for (const layer of manifest.layers) {
    const title = layer.annotations?.[titleAnnotation] ?? "";
    const parsedTitle = parseTitle(title);
    if (parsedTitle === null) {
      throw malformed(
        `the artefact of ${region} has a layer Trail does not know: ${JSON.stringify(title)}`,
      );
    }
    const { name, chunk } = parsedTitle;
    if (layer.mediaType !== artefactFiles[name]) {
      throw malformed(`the layer ${title} of ${region} has the media type ${layer.mediaType}`);
    }
    const group = groups.get(name) ?? { whole: [], chunks: new Map<number, Layer>() };
    groups.set(name, group);
    const entry = { digest: layer.digest, size: layer.size };
    if (chunk === null) {
      group.whole.push(entry);
    } else if (group.chunks.has(chunk)) {
      throw malformed(`the artefact of ${region} has the layer ${title} twice`);
    } else {
      group.chunks.set(chunk, entry);
    }
    totalBytes += layer.size;
    if (totalBytes > maxBytes) {
      throw new RegistryError(
        `the build ${buildId} of ${region} is over ${Math.round(maxBytes / 1e9)} GB (MAP_DATA_MAX_GB)`,
        { reason: "too_large" },
      );
    }
  }

  const files: PlannedFile[] = [];
  let manifestLayer: Layer | null = null;
  for (const [name, group] of groups) {
    let layers: Layer[];
    if (group.whole.length > 0) {
      if (group.whole.length > 1 || group.chunks.size > 0) {
        throw malformed(`the artefact of ${region} has ${name} more than once`);
      }
      layers = group.whole;
    } else {
      const count = group.chunks.size;
      layers = [];
      for (let index = 0; index < count; index += 1) {
        const layer = group.chunks.get(index);
        if (layer === undefined) {
          throw malformed(
            `the chunks of ${name} in ${region} are not numbered 000 to ${count - 1}`,
          );
        }
        layers.push(layer);
      }
      if (count < 2 || maxWholeBytes[name] !== undefined) {
        throw malformed(`${name} of ${region} is split into ${count} chunks`);
      }
    }
    const bytes = layers.reduce((sum, layer) => sum + layer.size, 0);
    const cap = maxWholeBytes[name];
    if (cap !== undefined && bytes > cap) {
      throw new RegistryError(`${name} of ${region} has ${bytes} bytes`, { reason: "too_large" });
    }
    if (name === "manifest.json") {
      manifestLayer = layers[0] ?? null;
    } else {
      files.push({ name, mediaType: artefactFiles[name], layers, bytes });
    }
  }

  const kind = region === worldRegion ? "world" : "region";
  for (const name of requiredFiles[kind]) {
    if (!groups.has(name)) throw malformed(`the artefact of ${region} has no ${name}`);
  }
  if (manifestLayer === null) throw malformed(`the artefact of ${region} has no manifest.json`);
  return { region, buildId, digest: resolved.digest, manifest: manifestLayer, files, totalBytes };
}

const hexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const trailManifestSchema = z.looseObject({
  mediaType: z.literal(artefactFiles["manifest.json"]),
  region: z.string(),
  build: z.looseObject({ id: z.string() }),
  extract: z.looseObject({ timestamp: z.string().nullable() }),
  files: z
    .array(
      z.looseObject({
        name: z.string(),
        mediaType: z.string(),
        bytes: z.number().int().min(0),
        sha256: hexSchema,
        chunks: z
          .array(
            z.looseObject({ name: z.string(), bytes: z.number().int().min(0), sha256: hexSchema }),
          )
          .optional(),
      }),
    )
    .max(32),
});

/** What the build's own manifest adds: the whole files' SHA-256 (of chunked files) and the extract's time. */
export interface TrailManifest {
  extractTimestamp: string | null;
  sha256: ReadonlyMap<ArtefactFileName, string>;
}

/**
 * Checks the build's `manifest.json` against the layout: the same region and
 * build, and exactly the files of the layers, with their sizes and the
 * SHA-256 of every whole file and chunk (scripts/mapdata/build.sh writes
 * both). A chunked file's whole SHA-256 is checked once it is put together.
 */
export function checkTrailManifest(layout: ArtefactLayout, bytes: Buffer): TrailManifest {
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw malformed(`manifest.json of ${layout.region} is not JSON`);
  }
  const parsed = trailManifestSchema.safeParse(json);
  if (!parsed.success) throw malformed(`manifest.json of ${layout.region} is not a Trail manifest`);
  const manifest = parsed.data;
  if (manifest.region !== layout.region || manifest.build.id !== layout.buildId) {
    throw malformed(
      `manifest.json describes ${manifest.region} ${manifest.build.id}, not ${layout.region} ${layout.buildId}`,
    );
  }
  const planned = new Map(layout.files.map((file) => [file.name, file]));
  const sha256 = new Map<ArtefactFileName, string>();
  for (const file of manifest.files) {
    const plan = isArtefactFile(file.name) ? planned.get(file.name) : undefined;
    if (plan === undefined || sha256.has(plan.name)) {
      throw malformed(
        `manifest.json of ${layout.region} lists ${file.name}, which the layers do not hold once`,
      );
    }
    if (file.mediaType !== plan.mediaType || file.bytes !== plan.bytes) {
      throw malformed(
        `manifest.json of ${layout.region} describes ${file.name} otherwise than its layers`,
      );
    }
    const [single] = plan.layers;
    if (plan.layers.length === 1 && single !== undefined) {
      if (file.chunks !== undefined || `sha256:${file.sha256}` !== single.digest) {
        throw malformed(
          `manifest.json of ${layout.region} gives ${file.name} another SHA-256 than its layer`,
        );
      }
    } else {
      const chunks = file.chunks ?? [];
      const same =
        chunks.length === plan.layers.length &&
        chunks.every((chunk, index) => {
          const layer = plan.layers[index];
          return (
            layer !== undefined &&
            chunk.name === `${file.name}.${String(index).padStart(3, "0")}` &&
            chunk.bytes === layer.size &&
            `sha256:${chunk.sha256}` === layer.digest
          );
        });
      if (!same) {
        throw malformed(
          `manifest.json of ${layout.region} describes the chunks of ${file.name} otherwise`,
        );
      }
    }
    sha256.set(plan.name, file.sha256);
  }
  if (sha256.size !== planned.size) {
    throw malformed(`manifest.json of ${layout.region} does not list every file of its layers`);
  }
  return { extractTimestamp: manifest.extract.timestamp, sha256 };
}
