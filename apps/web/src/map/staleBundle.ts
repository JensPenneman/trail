/** Where the self-hosted basemap's tiles are (`/map/tiles/<bundle>/…`). */
const tilePath = "/map/tiles/";

/** At most one reload of the style in this time: a map full of failing tiles asks once. */
const styleReloadIntervalMs = 60_000;

/**
 * A map left open keeps the bundle its style named; once the server has
 * pruned that bundle its tiles answer 404. This decides, for each map error,
 * whether the style is to be requested again (it names the new bundle): the
 * error is a 410 of a tile under `/map/tiles/`, and the last reload is at
 * least a minute ago.
 */
export function createStaleBundleCheck(now: () => number = Date.now): (error: unknown) => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return (error) => {
    const { status, url } = (error ?? {}) as { status?: unknown; url?: unknown };
    if (status !== 410 || typeof url !== "string") return false;
    if (!new URL(url, "http://localhost").pathname.includes(tilePath)) return false;
    const at = now();
    if (at - last < styleReloadIntervalMs) return false;
    last = at;
    return true;
  };
}
