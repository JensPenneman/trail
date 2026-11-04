import { expect, type Response } from "@playwright/test";
import { publicConfigSchema } from "@trail/contracts/config";
import { expectAccessible } from "./support/expectAccessible";
import type { OverlandBatch } from "./support/overlandBatch";
import { test } from "./support/test";
import { uploadedDevice } from "./support/uploadedDevice";

const immutable = "public, max-age=31536000, immutable";

/** Overland's own timestamp format: whole seconds, UTC. */
const timestamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * A phone in Monte Carlo, by the casino, for the last few minutes: inside the
 * one z14 tile of the Monaco fixture's streets (14/8530/5974), so the Live
 * view's camera lands where the suite's basemap has tiles.
 */
function monacoBatch(now = Date.now()): OverlandBatch {
  const points = [
    [7.4282, 43.7386],
    [7.4291, 43.7381],
    [7.4302, 43.7377],
  ] as const;
  return {
    locations: points.map(([lon, lat], index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        timestamp: timestamp(now - (points.length - index) * 60_000),
        horizontal_accuracy: 8,
        speed: 0.8,
        motion: ["walking"],
        battery_level: 0.7,
        battery_state: "unplugged",
      },
    })),
  };
}

const ownBasemap = async (request: { get(path: string): Promise<{ json(): Promise<unknown> }> }) =>
  publicConfigSchema.parse(await (await request.get("/api/config")).json()).mapStyles.basemap ===
  "self";

test("the map draws Monaco from the server's own basemap, and nothing from anywhere else", async ({
  page,
  account,
  baseURL,
}) => {
  expect(account.email).toBeTruthy();
  test.skip(!(await ownBasemap(page.request)), "This server draws no basemap of its own");
  const origin = new URL(baseURL ?? "http://invalid").origin;
  const fromMap: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "fetch" || request.resourceType() === "image") {
      fromMap.push(request.url());
    }
  });
  const answered = (pattern: RegExp) =>
    page.waitForResponse(
      (response: Response) =>
        pattern.test(new URL(response.url()).pathname) && response.status() === 200,
    );
  const tile = answered(/^\/map\/tiles\/[0-9a-f]{16}\/14\/\d+\/\d+\.pbf$/);
  const glyphs = answered(/^\/map\/assets\/[0-9a-f]{16}\/fonts\/Noto%20Sans%20\w+\/\d+-\d+\.pbf$/);
  const sprite = answered(/^\/map\/assets\/[0-9a-f]{16}\/sprites\/ofm(@2x)?\.png$/);

  await uploadedDevice(page, "Monaco phone", monacoBatch());
  await page.goto("/");
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toHaveAccessibleName(/^Map of where everyone is now/);
  const [tileAnswer] = await Promise.all([tile, glyphs, sprite]);
  // Stored gzipped, sent as stored, and cached for good: the bundle's id is in the path.
  expect(tileAnswer.headers()["content-encoding"]).toBe("gzip");
  expect(tileAnswer.headers()["cache-control"]).toBe(immutable);
  expect(tileAnswer.headers()["content-type"]).toBe("application/x-protobuf");

  const attribution = page.locator(".maplibregl-ctrl-attrib");
  await expect(attribution).toContainText("© OpenMapTiles");
  await expect(attribution).toContainText("© OpenStreetMap contributors");
  // stubMapStyles refuses every other origin, so a request that left would have failed the
  // test already; none was even made.
  const elsewhere = fromMap.filter((url) => !url.startsWith("data:") && !url.startsWith("blob:"));
  expect(elsewhere.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  await expectAccessible(page, "Live on the server's basemap of Monaco");
});

test("the server hands out the basemap's styles, tiles, fonts and sprites with their caching", {
  tag: "@signed-out",
}, async ({ request }) => {
  test.skip(!(await ownBasemap(request)), "This server draws no basemap of its own");
  const style = await request.get("/map/styles/light.json");
  expect(style.status()).toBe(200);
  expect(style.headers()["content-type"]).toBe("application/json; charset=utf-8");
  expect(style.headers()["cache-control"]).toBe("no-cache");
  const etag = style.headers()["etag"] ?? "";
  expect(
    (await request.get("/map/styles/light.json", { headers: { "If-None-Match": etag } })).status(),
  ).toBe(304);
  const { sources, glyphs, sprite } = (await style.json()) as {
    sources: { openmaptiles: { tiles: string[] } };
    glyphs: string;
    sprite: string;
  };
  const tiles = sources.openmaptiles.tiles[0] ?? "";
  expect(tiles).toMatch(/^https?:\/\/[^/]+\/map\/tiles\/[0-9a-f]{16}\/\{z\}\/\{x\}\/\{y\}\.pbf$/);

  const streets = await request.get(tiles.replace("{z}/{x}/{y}", "14/8530/5974"));
  expect(streets.status()).toBe(200);
  expect(streets.headers()["cache-control"]).toBe(immutable);
  expect(streets.headers()["etag"]).toMatch(/^"[0-9a-f]{16}"$/);
  const sea = await request.get(tiles.replace("{z}/{x}/{y}", "14/0/0"));
  expect(sea.status()).toBe(204);
  expect(sea.headers()["cache-control"]).toBe(immutable);

  // The glyphs the build laid out (scripts/map-assets.mjs): Latin, and not the CJK ranges,
  // which MapLibre draws with the browser's own fonts.
  const latin = await request.get(
    glyphs.replace("{fontstack}", "Noto Sans Regular").replace("{range}", "0-255"),
  );
  expect(latin.status()).toBe(200);
  expect(latin.headers()["cache-control"]).toBe(immutable);
  expect((await latin.body()).length).toBeGreaterThan(10_000);
  const ideographs = await request.get(
    glyphs.replace("{fontstack}", "Noto Sans Regular").replace("{range}", "19968-20223"),
  );
  expect(ideographs.status()).toBe(404);
  const sheet = await request.get(`${sprite}.json`);
  expect(sheet.status()).toBe(200);
  expect(Object.keys((await sheet.json()) as object)).toContain("airport");
  const image = await request.get(`${sprite}@2x.png`);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("a server without a basemap yet says so over a plain map", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  // The server as it is for its first minutes: no build on its volume, the fallback off.
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const config = publicConfigSchema.parse(await response.json());
    await route.fulfill({
      response,
      json: { ...config, mapStyles: { ...config.mapStyles, basemap: "none" } },
    });
  });
  await page.goto("/");
  const notice = page.getByRole("status").filter({ hasText: "Basemap not installed yet" });
  await expect(notice).toBeVisible();
  await expectAccessible(page, "Live without a basemap");
});
