import { AJAXError, ErrorEvent } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { createStaleBundleCheck } from "../src/map/staleBundle";

const tileUrl = "https://trail.example/map/tiles/0123456789abcdef/5/16/10.pbf";

/**
 * What MapLibre 6.15 fires as an `error` event for a tile whose request
 * failed: an `ErrorEvent` whose `error` is an `AJAXError` (status,
 * statusText, url, body) and which carries the tile. It fires none for a 404
 * (the tile is drawn as empty), which is why the server answers 410.
 */
const failedTile = (status: number, url: string) =>
  new ErrorEvent(new AJAXError(status, "", url, new Blob()), { tile: {} }).error;

const tile410 = failedTile(410, tileUrl);

describe("the check for a pruned basemap bundle", () => {
  it("fires for a 410 of a basemap tile, at most once a minute", () => {
    let time = 1_000_000;
    const check = createStaleBundleCheck(() => time);
    expect(check(tile410)).toBe(true);
    time += 59_999;
    expect(check(tile410)).toBe(false);
    time += 1;
    expect(check(tile410)).toBe(true);
  });

  it("ignores other errors and other URLs, without using up the minute", () => {
    const check = createStaleBundleCheck(() => 5);
    expect(check(failedTile(500, tileUrl))).toBe(false);
    expect(check(failedTile(404, tileUrl))).toBe(false);
    expect(
      check(failedTile(410, "https://trail.example/map/assets/x/fonts/a/0-255.pbf")),
    ).toBe(false);
    expect(check(new Error("boom"))).toBe(false);
    expect(check(undefined)).toBe(false);
    expect(check(tile410)).toBe(true);
  });
});
