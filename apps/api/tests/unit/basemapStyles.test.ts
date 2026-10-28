import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plainStyle, renderStyle, vendoredStyles } from "../../src/basemap/basemapStyles";
import { isGlyphRange, spriteFiles, spriteName } from "../../src/basemap/mapAssets";
import { tileCoordinates } from "../../src/basemap/mapRouter";

interface Layer {
  id: string;
  type: string;
  source?: string;
  layout?: { "text-font"?: string[] };
}

interface Style {
  sources: Record<string, Record<string, unknown>>;
  glyphs?: string;
  sprite?: string;
  layers: Layer[];
  metadata?: Record<string, unknown>;
}

const parse = (body: Buffer): Style => JSON.parse(body.toString("utf8")) as Style;
const served = (name: "light" | "dark") =>
  parse(renderStyle(name, { bundle: "0123456789abcdef", assets: "fedcba9876543210" }).body);

/** scripts/map-assets.json: the font stacks the image ships glyphs of. */
const pinned = JSON.parse(
  readFileSync(new URL("../../../../scripts/map-assets.json", import.meta.url), "utf8"),
) as { fonts: { stacks: string[] }; sprites: { files: Record<string, unknown> } };

describe("the served styles", () => {
  for (const name of ["light", "dark"] as const) {
    it(`load ${name}'s tiles, glyphs and sprite from Trail's own origin only`, () => {
      const style = served(name);
      expect(Object.keys(style.sources)).toEqual(["openmaptiles"]);
      expect(style.sources["openmaptiles"]).toMatchObject({
        type: "vector",
        tiles: ["/map/tiles/0123456789abcdef/{z}/{x}/{y}.pbf"],
        maxzoom: 14,
      });
      expect(style.sources["openmaptiles"]).not.toHaveProperty("url");
      expect(style.glyphs).toBe("/map/assets/fedcba9876543210/fonts/{fontstack}/{range}.pbf");
      expect(style.sprite).toBe(`/map/assets/fedcba9876543210/sprites/${spriteName}`);
      // Every layer draws from that source (or none, the background): nothing else is fetched.
      for (const layer of style.layers) {
        if (layer.source !== undefined) expect(layer.source, layer.id).toBe("openmaptiles");
      }
      expect(style.layers.map((layer) => layer.id)).toEqual(
        (vendoredStyles[name]["layers"] as Layer[]).map((layer) => layer.id),
      );
    });
  }

  it("keep the vendored files as OpenFreeMap served them, without the relief layer, with their origin", () => {
    for (const style of Object.values(vendoredStyles) as unknown as Style[]) {
      expect(Object.keys(style.sources)).toEqual(["openmaptiles"]);
      expect(style.layers.filter((layer) => layer.type === "raster")).toEqual([]);
      expect(style.metadata).toMatchObject({
        "trail:origin": expect.stringMatching(/^https:\/\/tiles\.openfreemap\.org\/styles\//),
        "trail:licence": expect.stringContaining("MIT"),
      });
    }
  });

  it("name only font stacks the image has glyphs of, and a sprite sheet it ships", () => {
    const stacks = new Set<string>();
    for (const style of Object.values(vendoredStyles) as unknown as Style[]) {
      for (const layer of style.layers) {
        for (const font of layer.layout?.["text-font"] ?? []) stacks.add(font);
      }
    }
    expect([...stacks].sort()).toEqual(pinned.fonts.stacks);
    expect(Object.keys(pinned.sprites.files).sort()).toEqual([...spriteFiles].sort());
  });

  it("have a plain ground in the map box's colours when there is no basemap", () => {
    const light = parse(plainStyle("light").body);
    expect(light).toMatchObject({ version: 8, sources: {}, metadata: { "trail:basemap": "none" } });
    expect(light.layers).toEqual([
      { id: "background", type: "background", paint: { "background-color": "#f4f2ef" } },
    ]);
    expect(parse(plainStyle("dark").body).layers[0]).toMatchObject({
      paint: { "background-color": "#242629" },
    });
    expect(plainStyle("light").etag).not.toBe(plainStyle("dark").etag);
  });
});

describe("the names a map request may use", () => {
  it("are a tile's numbers, inside the zoom's grid, each written one way", () => {
    expect(tileCoordinates("14", "8530", "5974.pbf")).toEqual({ z: 14, x: 8530, y: 5974 });
    expect(tileCoordinates("0", "0", "0.pbf")).toEqual({ z: 0, x: 0, y: 0 });
    for (const [z, x, y] of [
      ["15", "0", "0.pbf"],
      ["2", "4", "0.pbf"],
      ["2", "0", "4.pbf"],
      ["07", "1", "1.pbf"],
      ["7", "-1", "1.pbf"],
      ["7", "1.0", "1.pbf"],
      ["7", "1", "1.mvt"],
      ["7", "1", "1"],
      ["7", "1", "..%2F1.pbf"],
      ["", "1", "1.pbf"],
      ["7", "1e1", "1.pbf"],
    ]) {
      expect(tileCoordinates(z ?? "", x ?? "", y ?? ""), `${z}/${x}/${y}`).toBeNull();
    }
  });

  it("are a glyph range of 256 code points as MapLibre names it", () => {
    expect(isGlyphRange("0-255")).toBe(true);
    expect(isGlyphRange("65280-65535")).toBe(true);
    for (const name of ["0-256", "1-256", "256-255", "65536-65791", "00-255", "0-255.pbf", "a-b"]) {
      expect(isGlyphRange(name), name).toBe(false);
    }
  });
});
