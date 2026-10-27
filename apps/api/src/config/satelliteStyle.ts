import type { SatelliteStyle } from "@trail/contracts/config";

/** What MapLibre fills in for a tile; Leaflet's `{s}` and friends would reach the server as is. */
const placeholders = ["{z}", "{x}", "{y}"] as const;

interface SatelliteSetting {
  style: SatelliteStyle | null;
  /** Why the variables cannot be used, for the configuration error. */
  problem: { variable: string; message: string } | null;
}

/**
 * `MAP_STYLE_SATELLITE` (docs/operations.md, "Satellite imagery"): a MapLibre
 * style URL, or the URL template of raster tiles (`{z}`, `{x}` and `{y}` make
 * it one), which needs the provider's credit in
 * `MAP_STYLE_SATELLITE_ATTRIBUTION`: imagery comes with terms that ask for it
 * on the map, and a whole style carries its own.
 */
export function readSatelliteStyle(
  url: string | undefined,
  attribution: string | undefined,
): SatelliteSetting {
  if (url === undefined) return { style: null, problem: null };
  if (!url.includes("{")) return { style: { kind: "style", url }, problem: null };
  const unknown = (url.match(/\{[^}]*\}/g) ?? []).filter(
    (token) => !(placeholders as readonly string[]).includes(token),
  );
  const missing = placeholders.filter((placeholder) => !url.includes(placeholder));
  if (unknown.length > 0 || missing.length > 0) {
    return {
      style: null,
      problem: {
        variable: "MAP_STYLE_SATELLITE",
        message:
          unknown.length > 0
            ? `${unknown.join(", ")} is not filled in; a tile URL template takes {z}, {x} and {y} only`
            : `a tile URL template needs ${missing.join(", ")}`,
      },
    };
  }
  if (attribution === undefined) {
    return {
      style: null,
      problem: {
        variable: "MAP_STYLE_SATELLITE_ATTRIBUTION",
        message: "is required with a tile URL template: the credit the imagery provider asks for",
      },
    };
  }
  return { style: { kind: "raster", tiles: url, attribution }, problem: null };
}
