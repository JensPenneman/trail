import { createHash } from "node:crypto";
import {
  type ArtefactFile,
  artefactDirectory,
  fileChunks,
  hasArtefactFile,
  openArtefactFile,
  readArtefactFile,
  sha256Hex,
} from "./artefactFiles";
import { type BuildKey, buildSource } from "./buildPartitions";
import { MapDataError } from "./mapDataError";
import { type DataFile, dataFiles, type MapManifest, readManifest } from "./mapManifest";
import { parseRegionPoly, type RegionOutline } from "./regionPoly";

/** The largest files an artefact may have (docs/design/self-hosted-maps.md §7): Europe's ways are 8–10 GB. */
const maxBytes = {
  manifest: 1 << 20,
  ways: 64 * 2 ** 30,
  pois: 4 * 2 ** 30,
  poly: 16 << 20,
} satisfies Record<DataFile | "manifest", number>;

/** A build's directory, checked against its manifest and open for the import. */
export interface Artefact {
  manifest: MapManifest;
  /** `sha256:<hex>`: the build's identity. */
  digest: string;
  key: BuildKey;
  /** The `source` its rows get. */
  source: string;
  ways: ArtefactFile;
  pois: ArtefactFile;
  outline: RegionOutline;
  close(): Promise<void>;
}

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const sha256Of = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function readWhole(file: ArtefactFile): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of fileChunks(file)) parts.push(chunk);
  return Buffer.concat(parts);
}

/**
 * Opens a build's directory for `importRegion`: reads manifest.json, takes
 * the build's digest (the one given, which the registry pull knows; else the
 * SHA-256 of oci-manifest.json, which a pulled build keeps, or of
 * manifest.json for a hand-made build), opens the three data files by their
 * fixed names and checks each against the manifest's size and SHA-256, and
 * reads the region's polygon. Nothing is written yet.
 */
export async function openArtefact(dirName: string, digest: string | null): Promise<Artefact> {
  const dir = await artefactDirectory(dirName);
  const manifestBytes = await readArtefactFile(dir, "manifest.json", maxBytes.manifest);
  let json: unknown;
  try {
    json = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new MapDataError("manifest.json is not JSON");
  }
  const manifest = readManifest(json);
  if (digest !== null && !sha256Pattern.test(digest)) {
    throw new MapDataError(`${digest} is no sha256 digest`);
  }
  const identity =
    digest ??
    ((await hasArtefactFile(dir, "oci-manifest.json"))
      ? sha256Of(await readArtefactFile(dir, "oci-manifest.json", maxBytes.manifest))
      : sha256Of(manifestBytes));
  const key: BuildKey = { region: manifest.region, buildId: manifest.buildId, digest: identity };

  const opened: ArtefactFile[] = [];
  const close = async () => {
    for (const file of opened) await file.handle.close();
  };
  try {
    const open = async (name: DataFile) => {
      const file = await openArtefactFile(dir, dataFiles[name], {
        maxBytes: maxBytes[name],
        bytes: manifest.files[name].bytes,
      });
      opened.push(file);
      return file;
    };
    const ways = await open("ways");
    const pois = await open("pois");
    const poly = await open("poly");
    for (const [file, sha256] of [
      [ways, manifest.files.ways.sha256],
      [pois, manifest.files.pois.sha256],
    ] as const) {
      if ((await sha256Hex(file)) !== sha256) {
        throw new MapDataError(`${file.name} does not match its SHA-256 in manifest.json`);
      }
    }
    const polyBytes = await readWhole(poly);
    if (sha256Of(polyBytes) !== `sha256:${manifest.files.poly.sha256}`) {
      throw new MapDataError("region.poly does not match its SHA-256 in manifest.json");
    }
    const outline = parseRegionPoly(polyBytes.toString("utf8"));
    return {
      manifest,
      digest: identity,
      key,
      source: buildSource(key),
      ways,
      pois,
      outline,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
