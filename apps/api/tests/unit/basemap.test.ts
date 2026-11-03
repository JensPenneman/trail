import { rmSync } from "node:fs";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { Basemap } from "../../src/basemap/basemap";
import { readMapAssets } from "../../src/basemap/mapAssets";
import type { BasemapSettings } from "../../src/config/config";
import { createLogger } from "../../src/logging/createLogger";
import {
  emptyVolume,
  monacoBasemap,
  monacoStreets,
  placeBuild,
  testAssets,
  webDistWithAssets,
} from "../support/basemapVolume";
import { writePmtiles } from "../support/pmtilesWriter";

const self: BasemapSettings = { mode: "self", region: "monaco", fallback: true };
const assets = () => readMapAssets(webDistWithAssets());

const started: Basemap[] = [];
afterEach(async () => {
  for (const basemap of started.splice(0)) await basemap.stop();
});

/** A basemap over `dir`, started, and the lines it logged. */
async function startBasemap(
  dir: string,
  settings: BasemapSettings = self,
  withAssets: boolean = true,
) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "info",
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString("utf8")) as Record<string, unknown>);
        done();
      },
    }),
  });
  const basemap = new Basemap({
    settings,
    dir,
    publicUrl: "https://trail.example",
    assets: withAssets ? assets() : null,
    logger,
    rescanMs: 3_600_000,
  });
  started.push(basemap);
  await basemap.start();
  return { basemap, lines };
}

const styleOf = (basemap: Basemap, name: "light" | "dark") =>
  JSON.parse(basemap.style(name).body.toString("utf8")) as {
    sources: Record<string, { tiles?: string[]; url?: string; attribution?: string }>;
    glyphs?: string;
    sprite?: string;
    layers: { id: string; source?: string }[];
    metadata?: Record<string, unknown>;
  };

describe("Basemap", () => {
  it("serves the newest build of the region with the world overview, as one bundle", async () => {
    const volume = emptyVolume();
    placeBuild(volume, "monaco", {
      buildId: "20261027",
      files: { "basemap.pmtiles": monacoBasemap },
    });
    const world = placeBuild(volume, "world", {
      buildId: "20261027",
      files: {
        "basemap.pmtiles": writePmtiles({ tiles: [{ z: 0, x: 0, y: 0, data: Buffer.from("w") }] }),
      },
    });
    const { basemap } = await startBasemap(volume);
    const state = basemap.state();
    expect(state).toMatchObject({ source: "self", assets: true });
    expect(state.region).toMatch(/^monaco 20261027-[0-9a-f]{8}$/);
    expect(state.world).toBe(world.name);
    const bundle = basemap.bundle(state.bundle ?? "");
    expect(bundle?.world?.build.digest).toBe(world.digest);

    const light = styleOf(basemap, "light");
    expect(light.sources["openmaptiles"]).toEqual({
      type: "vector",
      tiles: [`https://trail.example/map/tiles/${state.bundle}/{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 14,
      attribution: expect.stringContaining("&copy; OpenStreetMap contributors"),
    });
    expect(light.glyphs).toBe(
      `https://trail.example/map/assets/${testAssets.hash}/fonts/{fontstack}/{range}.pbf`,
    );
    expect(light.sprite).toBe(`https://trail.example/map/assets/${testAssets.hash}/sprites/ofm`);
    expect(styleOf(basemap, "dark").sources["openmaptiles"]?.tiles).toEqual(
      light.sources["openmaptiles"]?.tiles,
    );
    expect(basemap.style("light").etag).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it("switches to a newer build and serves the bundles before it while their builds are on the volume", async () => {
    const volume = emptyVolume();
    const files = { "basemap.pmtiles": monacoBasemap };
    const oldest = placeBuild(volume, "monaco", { buildId: "20261027", files });
    const { basemap, lines } = await startBasemap(volume);
    const first = basemap.state().bundle ?? "";

    placeBuild(volume, "monaco", { buildId: "20261124", files });
    await basemap.rescan();
    const second = basemap.state().bundle ?? "";
    expect(second).not.toBe(first);
    expect(basemap.state().region).toMatch(/^monaco 20261124-/);
    // A map opened on the first bundle still gets its tiles.
    const kept = basemap.bundle(first);
    expect(kept).not.toBeNull();
    expect(
      await kept?.region.archive.tile(monacoStreets.z, monacoStreets.x, monacoStreets.y),
    ).not.toBeNull();

    // A refresh of the overview minutes later is a third bundle; the first serves on.
    placeBuild(volume, "world", { buildId: "20261124", files });
    await basemap.rescan();
    expect(basemap.state().world).toMatch(/^20261124-/);
    expect(basemap.bundle(first)).toBe(kept);
    expect(basemap.bundle(second)).not.toBeNull();

    // The next refresh deletes the oldest build: until the next look its open file serves on…
    rmSync(oldest.dir, { recursive: true });
    expect(
      await kept?.region.archive.tile(monacoStreets.z, monacoStreets.x, monacoStreets.y),
    ).not.toBeNull();
    // … then its bundle goes and its archive is closed: a map that kept it that long reloads.
    await basemap.rescan();
    expect(basemap.bundle(first)).toBeNull();
    expect(basemap.bundle(second)).not.toBeNull();
    await expect(kept?.region.archive.tile(0, 0, 0)).rejects.toThrow(/closed/);
    expect(lines.filter((line) => line["msg"] === "basemap: serving a new bundle")).toHaveLength(3);
  });

  it("skips a build without a basemap and refuses a broken one, once, for the build before them", async () => {
    const volume = emptyVolume();
    const good = placeBuild(volume, "monaco", {
      buildId: "20261027",
      files: { "basemap.pmtiles": monacoBasemap },
    });
    placeBuild(volume, "monaco", {
      buildId: "20261124",
      files: { "manifest.json": Buffer.from("{}") },
    });
    const broken = placeBuild(volume, "monaco", {
      buildId: "20261222",
      files: { "basemap.pmtiles": Buffer.alloc(1024, 1) },
    });
    const { basemap, lines } = await startBasemap(volume);
    expect(basemap.state().region).toBe(`monaco ${good.name}`);
    await basemap.rescan();
    const refused = lines.filter(
      (line) => line["msg"] === "basemap: the build's basemap.pmtiles was refused",
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ region: "monaco", build: broken.name });
  });

  it("without a basemap on the volume: the external styles, or a plain ground when the fallback is off", async () => {
    const { basemap: fallback } = await startBasemap(emptyVolume());
    expect(fallback.state()).toMatchObject({ source: "external", bundle: null });

    const { basemap: plain } = await startBasemap(emptyVolume(), { ...self, fallback: false });
    expect(plain.source()).toBe("none");
    const style = styleOf(plain, "dark");
    expect(style.sources).toEqual({});
    expect(style.glyphs).toBeUndefined();
    expect(style.metadata).toEqual({ "trail:basemap": "none" });
  });

  it("serves no basemap of its own without the image's fonts and sprites, or with MAP_BASEMAP=openfreemap", async () => {
    const volume = emptyVolume();
    placeBuild(volume, "monaco", {
      buildId: "20261027",
      files: { "basemap.pmtiles": monacoBasemap },
    });
    const { basemap: noAssets, lines } = await startBasemap(volume, self, false);
    expect(noAssets.state()).toMatchObject({ source: "external", assets: false });
    expect(noAssets.state().bundle).not.toBeNull();
    expect(lines.some((line) => String(line["msg"]).includes("no map fonts or sprites"))).toBe(
      true,
    );

    const { basemap: external } = await startBasemap(volume, { ...self, mode: "openfreemap" });
    expect(external.state()).toMatchObject({ source: "external", bundle: null });
    expect(styleOf(external, "light").sources).toEqual({});
  });

  it("draws nobody's basemap without a region", async () => {
    const volume = emptyVolume();
    placeBuild(volume, "world", {
      buildId: "20261027",
      files: { "basemap.pmtiles": monacoBasemap },
    });
    const { basemap } = await startBasemap(volume, { ...self, region: null });
    expect(basemap.state()).toMatchObject({ source: "external", bundle: null });
  });

  it("falls back once the region's builds are gone from the volume", async () => {
    const volume = emptyVolume();
    placeBuild(volume, "monaco", {
      buildId: "20261027",
      files: { "basemap.pmtiles": monacoBasemap },
    });
    const { basemap, lines } = await startBasemap(volume);
    const bundle = basemap.state().bundle;
    rmSync(`${volume}/regions/monaco`, { recursive: true });
    await basemap.rescan();
    expect(basemap.state()).toMatchObject({ source: "external", bundle: null });
    expect(basemap.bundle(bundle ?? "")).toBeNull();
    expect(lines.some((line) => line["msg"] === "basemap: none on the volume")).toBe(true);
  });
});
