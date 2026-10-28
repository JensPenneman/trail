import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fixtureLines, monacoDir } from "./mapDataFixture";

export interface ArtefactChanges {
  /** The lines of ways.opl.gz, changed. */
  ways?: (lines: string[]) => string[];
  /** The lines of pois.geojsonseq.gz, changed. */
  pois?: (lines: string[]) => string[];
  /** Bytes for ways.opl.gz as they are (a damaged or hostile file). */
  waysFile?: Buffer;
  /** The manifest, changed after its files and counts were brought up to date. */
  manifest?: (json: Record<string, unknown>) => void;
  /** Leave the manifest's sizes and checksums as the fixture's: a file damaged after the build. */
  keepChecksums?: boolean;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const gzipLines = (lines: readonly string[]) => gzipSync(Buffer.from(`${lines.join("\n")}\n`));

/** Node references of an OPL line, as keep-tags.awk counts them. */
const nodeRefs = (line: string) => {
  const field = line.split(" ").find((part) => part.startsWith("N")) ?? "N";
  return field.length > 1 ? field.split(",").length : 0;
};

/**
 * A copy of the Monaco artefact in a directory of its own, changed as asked,
 * with manifest.json brought up to date as build.sh would write it: sizes,
 * checksums, counts and a build time of its own, so its digest differs.
 */
export function writeArtefact(changes: ArtefactChanges = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "trail-mapdata-"));
  for (const name of ["ways.opl.gz", "pois.geojsonseq.gz", "region.poly", "basemap.pmtiles"]) {
    cpSync(join(monacoDir, name), join(dir, name));
  }
  const wayLines = (changes.ways ?? ((lines) => lines))(fixtureLines("ways.opl.gz"));
  const poiLines = (changes.pois ?? ((lines) => lines))(fixtureLines("pois.geojsonseq.gz"));
  const files: Record<string, Buffer> = {
    "ways.opl.gz":
      changes.waysFile ??
      (changes.ways === undefined
        ? readFileSync(join(monacoDir, "ways.opl.gz"))
        : gzipLines(wayLines)),
    "pois.geojsonseq.gz":
      changes.pois === undefined
        ? readFileSync(join(monacoDir, "pois.geojsonseq.gz"))
        : gzipLines(poiLines),
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  const manifest = JSON.parse(readFileSync(join(monacoDir, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  > & {
    build: Record<string, unknown>;
    counts: { ways: number; wayNodeRefs: number; pois: { features: number } };
    files: { name: string; bytes: number; sha256: string }[];
  };
  // A build of its own: copies made within the same second must not share a digest.
  manifest.build = {
    ...manifest.build,
    at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    commit: randomBytes(20).toString("hex"),
  };
  if (changes.keepChecksums !== true) {
    manifest.counts.ways = wayLines.length;
    manifest.counts.wayNodeRefs = wayLines.reduce((sum, line) => sum + nodeRefs(line), 0);
    manifest.counts.pois.features = poiLines.length;
    for (const file of manifest.files) {
      const bytes = files[file.name];
      if (bytes === undefined) continue;
      file.bytes = bytes.byteLength;
      file.sha256 = sha256(bytes);
    }
  }
  changes.manifest?.(manifest);
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** The digest of a hand import: the SHA-256 of the directory's manifest.json. */
export const manifestDigest = (dir: string): string =>
  `sha256:${sha256(readFileSync(join(dir, "manifest.json")))}`;
