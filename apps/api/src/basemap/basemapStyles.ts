import { createHash } from "node:crypto";
import dark from "../../map/styles/dark.json";
import liberty from "../../map/styles/liberty.json";
import { spriteName } from "./mapAssets";

/** The two basemap styles: Light is OpenFreeMap's `liberty`, Dark its `dark` (§14). */
export type StyleName = "light" | "dark";

/** The vendored styles, as fetched from OpenFreeMap but for their relief layer (apps/api/map/styles). */
export const vendoredStyles: Readonly<Record<StyleName, Readonly<Record<string, unknown>>>> = {
  light: liberty,
  dark,
};

/** What the map credits for the self-hosted tiles: MapLibre's attribution control shows it. */
const basemapAttribution =
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';

/** The schema's native maximum: MapLibre overzooms from there (§3.1). */
const maxZoom = 14;

/** A style as it is served: its bytes, and the ETag they make. */
export interface ServedStyle {
  body: Buffer;
  etag: string;
}

const served = (style: unknown): ServedStyle => {
  const body = Buffer.from(JSON.stringify(style));
  return { body, etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"` };
};

/**
 * A vendored style rewritten for this server (docs/design/self-hosted-maps.md
 * §3.2): its vector source becomes the bundle's tiles, its glyphs and sprite
 * the image's assets, all as paths on Trail's own origin — every origin the
 * dashboard is opened on (`PUBLIC_URL`, `ADDITIONAL_ORIGINS`, a preview) —
 * which MapLibre's same-origin worker resolves against its own address.
 */
export function renderStyle(
  name: StyleName,
  input: { bundle: string; assets: string },
): ServedStyle {
  const style = vendoredStyles[name];
  return served({
    ...style,
    sources: {
      ...(style["sources"] as Record<string, unknown>),
      openmaptiles: {
        type: "vector",
        tiles: [`/map/tiles/${input.bundle}/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: maxZoom,
        attribution: basemapAttribution,
      },
    },
    glyphs: `/map/assets/${input.assets}/fonts/{fontstack}/{range}.pbf`,
    sprite: `/map/assets/${input.assets}/sprites/${spriteName}`,
  });
}

/** The ground of the map's own box (`--color-surface-2`): Trail's lines read on it as on a basemap. */
const plainGround: Readonly<Record<StyleName, string>> = { light: "#f4f2ef", dark: "#242629" };

/**
 * The map without a basemap (§3.5, `MAP_BASEMAP_FALLBACK=false` before the
 * first build is on the volume): a plain ground in the page's colours, under
 * Trail's own layers, and the notice the web app shows beside it.
 */
export function plainStyle(name: StyleName): ServedStyle {
  return served({
    version: 8,
    name: "Trail without a basemap",
    metadata: { "trail:basemap": "none" },
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": plainGround[name] } },
    ],
  });
}
