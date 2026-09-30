import type { BrowserContext } from "@playwright/test";
import { publicConfigSchema } from "@trail/contracts/config";

/** A MapLibre style with nothing but a background: the map works without any tile server. */
const style = (background: string) => ({
  version: 8,
  name: "Trail end-to-end tests",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": background } }],
});

const styles = { light: style("#e8e4dc"), dark: style("#23262a") };

/**
 * Keeps the suite off the internet: the configured map styles (GET /api/config)
 * are answered with a plain background, and every other request to another
 * origin is refused — an unexpected third-party request then fails the test
 * through the console guard. The app's own data layers still render on the map.
 */
export async function stubMapStyles(context: BrowserContext, appOrigin: string): Promise<void> {
  const response = await context.request.get("/api/config");
  const { mapStyles } = publicConfigSchema.parse(await response.json());
  await context.route(
    (url) => url.origin !== appOrigin,
    (route) => {
      const url = route.request().url();
      if (url === mapStyles.light) return route.fulfill({ json: styles.light });
      if (url === mapStyles.dark) return route.fulfill({ json: styles.dark });
      return route.abort("blockedbyclient");
    },
  );
}
