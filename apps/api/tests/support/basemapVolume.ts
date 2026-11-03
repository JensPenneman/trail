import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monacoDir } from "./mapDataFixture";

/** The Monaco fixture's basemap: z0–14 over the extract's bounding box (its README). */
export const monacoBasemap = join(monacoDir, "basemap.pmtiles");

/** A tile of Monaco's streets, inside the fixture at z14, and one of the open sea far from it. */
export const monacoStreets = { z: 14, x: 8530, y: 5974 } as const;
export const farAway = { z: 14, x: 0, y: 0 } as const;

/** An empty map data volume (`MAP_DATA_DIR`) of its own. */
export const emptyVolume = (): string => mkdtempSync(join(tmpdir(), "trail-basemap-"));

/**
 * A pulled build on the volume, as the registry client leaves one
 * (`regions/<region>/<yyyymmdd>-<digest8>/` with `oci-manifest.json`):
 * the manifest is made up, its SHA-256 the build's digest, and the files are
 * copied from paths or written from bytes.
 */
export function placeBuild(
  root: string,
  region: string,
  input: { buildId: string; files: Record<string, string | Buffer> },
): { dir: string; name: string; digest: string } {
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      region,
      build: input.buildId,
      n: randomBytes(8).toString("hex"),
    }),
  );
  const hex = createHash("sha256").update(manifest).digest("hex");
  const name = `${input.buildId}-${hex.slice(0, 8)}`;
  const dir = join(root, "regions", region, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(input.files)) {
    if (typeof content === "string") cpSync(content, join(dir, file));
    else writeFileSync(join(dir, file), content);
  }
  writeFileSync(join(dir, "oci-manifest.json"), manifest);
  return { dir, name, digest: `sha256:${hex}` };
}

/** The fonts and sprites of a build, made up: what `scripts/map-assets.mjs` lays out. */
export const testAssets = {
  hash: "0123456789abcdef",
  fonts: ["Noto Sans Bold", "Noto Sans Italic", "Noto Sans Regular"],
  glyphs: Buffer.from("glyphs of 0-255"),
  sprite: Buffer.from('{"airport":{"x":0,"y":0,"width":21,"height":21,"pixelRatio":1}}'),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
} as const;

/** A web build directory with only the map assets in it (no index.html: the API serves no SPA). */
export function webDistWithAssets(): string {
  const dist = mkdtempSync(join(tmpdir(), "trail-web-dist-"));
  const dir = join(dist, "map-assets", testAssets.hash);
  for (const font of testAssets.fonts) {
    mkdirSync(join(dir, "fonts", font), { recursive: true });
    writeFileSync(join(dir, "fonts", font, "0-255.pbf"), testAssets.glyphs);
  }
  mkdirSync(join(dir, "sprites"));
  for (const name of ["ofm.json", "ofm@2x.json"]) {
    writeFileSync(join(dir, "sprites", name), testAssets.sprite);
  }
  for (const name of ["ofm.png", "ofm@2x.png"])
    writeFileSync(join(dir, "sprites", name), testAssets.png);
  writeFileSync(
    join(dist, "map-assets", "assets.json"),
    JSON.stringify({ hash: testAssets.hash, fonts: testAssets.fonts }),
  );
  return dist;
}
