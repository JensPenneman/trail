import type { BrowserContext } from "@playwright/test";
import { publicConfigSchema } from "@trail/contracts/config";

/** A MapLibre style with nothing but a background: the map works without any tile server. */
const style = (background: string) => ({
  version: 8,
  name: "Trail end-to-end tests",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": background } }],
});

const styles = {
  light: style("#e8e4dc"),
  dark: style("#23262a"),
  satellite: style("#2d4a2b"),
};

/** One dark-green pixel: every imagery tile. */
const imageryTile = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPwSnf8DwAD4wHyXrfCIAAAAABJRU5ErkJggg==",
  "base64",
);

/** Whether `url` comes from the host of the raster template `tiles` (a test-only host). */
const isTileOf = (tiles: string, url: string): boolean =>
  new URL(url).origin === new URL(tiles.replace(/\{[xyz]\}/g, "0")).origin;

/**
 * Keeps the suite off the internet: the configured map styles (GET /api/config)
 * are answered with a plain background, satellite imagery with plain tiles,
 * and every other request to another origin is refused — an unexpected
 * third-party request then fails the test through the console guard. The
 * app's own data layers still render on the map.
 */
export async function stubMapStyles(context: BrowserContext, appOrigin: string): Promise<void> {
  const response = await context.request.get("/api/config");
  const { mapStyles } = publicConfigSchema.parse(await response.json());
  const { satellite } = mapStyles;
  await context.route(
    (url) => url.origin !== appOrigin,
    (route) => {
      const url = route.request().url();
      if (url === mapStyles.light) return route.fulfill({ json: styles.light });
      if (url === mapStyles.dark) return route.fulfill({ json: styles.dark });
      if (satellite?.kind === "style" && url === satellite.url) {
        return route.fulfill({ json: styles.satellite });
      }
      if (satellite?.kind === "raster" && isTileOf(satellite.tiles, url)) {
        return route.fulfill({ body: imageryTile, contentType: "image/png" });
      }
      return route.abort("blockedbyclient");
    },
  );
}
