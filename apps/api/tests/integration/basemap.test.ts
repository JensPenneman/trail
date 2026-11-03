import { rmSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { publicConfigSchema } from "@trail/contracts/config";
import { healthSchema } from "@trail/contracts/health";
import { PMTiles, ResolvedValueCache } from "pmtiles";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArchiveFileSource } from "../../src/basemap/archiveFileSource";
import {
  emptyVolume,
  farAway,
  monacoBasemap,
  monacoStreets,
  placeBuild,
  testAssets,
  webDistWithAssets,
} from "../support/basemapVolume";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";
import { otherOrigin, testOrigin } from "../support/testEnvironment";

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  /** The bytes as they came over the wire: never inflated on the way. */
  body: Buffer;
}

/** A GET with node:http, which hands over the body as sent (supertest would inflate it). */
function get(server: Server, path: string, headers: Record<string, string> = {}): Promise<Answer> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { host: "127.0.0.1", port, path, headers: { "accept-encoding": "gzip, br", ...headers } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** The fixture's tile as the library reads it: inflated. */
async function libraryTile(z: number, x: number, y: number): Promise<Buffer> {
  const { open } = await import("node:fs/promises");
  const handle = await open(monacoBasemap);
  try {
    const { size } = await handle.stat();
    const archive = new PMTiles(
      new ArchiveFileSource(handle, size, "library"),
      new ResolvedValueCache(),
    );
    const tile = await archive.getZxy(z, x, y);
    return Buffer.from(tile?.data ?? new ArrayBuffer(0));
  } finally {
    await handle.close();
  }
}

const immutable = "public, max-age=31536000, immutable";
const tilePath = (bundle: string, { z, x, y }: { z: number; x: number; y: number }) =>
  `/map/tiles/${bundle}/${z}/${x}/${y}.pbf`;

const unknownBundle = "0123456789abcdef";

/** A volume with Monaco's basemap (and, with `world`, the overview), and an app over it. */
async function startApp(
  options: { world?: boolean; env?: Record<string, string> } = {},
): Promise<{ volume: string; webDist: string; t: TestContext; bundle: string }> {
  const volume = emptyVolume();
  const webDist = webDistWithAssets();
  placeBuild(volume, "monaco", {
    buildId: "20261027",
    files: { "basemap.pmtiles": monacoBasemap },
  });
  if (options.world === true) {
    placeBuild(volume, "world", {
      buildId: "20261027",
      files: { "basemap.pmtiles": monacoBasemap },
    });
  }
  const t = await createTestContext({
    env: {
      MAP_DATA_DIR: volume,
      MAP_BASEMAP_REGION: "monaco",
      RATE_LIMIT_MAP_PER_MINUTE: "100000",
      ...options.env,
    },
    webDistDir: webDist,
  });
  return { volume, webDist, t, bundle: t.ctx.basemap.state().bundle ?? "" };
}

async function stopApp(app: { volume: string; webDist: string; t: TestContext }): Promise<void> {
  await app.t.close();
  rmSync(app.volume, { recursive: true, force: true });
  rmSync(app.webDist, { recursive: true, force: true });
}

describe("the basemap served from the map data volume", () => {
  let volume: string;
  let webDist: string;
  let t: TestContext;
  let bundle: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ volume, webDist, t, bundle } = await startApp({ env: { MAP_BASEMAP_FALLBACK: "false" } }));
  });

  afterAll(() => stopApp({ volume, webDist, t }));

  it("is what the config and the health check name, with the map origins down to 'self'", async () => {
    const config = await get(t.app, "/api/config");
    expect(publicConfigSchema.parse(JSON.parse(config.body.toString())).mapStyles).toEqual({
      light: `${testOrigin}/map/styles/light.json`,
      dark: `${testOrigin}/map/styles/dark.json`,
      basemap: "self",
    });
    const csp = String(config.headers["content-security-policy"]);
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).toContain("connect-src 'self';");
    const health = await get(t.app, "/api/health");
    expect(healthSchema.parse(JSON.parse(health.body.toString())).basemap).toBe("self");
  });

  it("puts the style's and the config's URLs on the origin of the request when it is allowed, else on PUBLIC_URL", async () => {
    const urlsOf = async (host: string) => {
      const style = JSON.parse(
        (
          await get(t.app, "/map/styles/light.json", { host, "accept-encoding": "identity" })
        ).body.toString(),
      ) as {
        sources: { openmaptiles: { tiles: string[] } };
        glyphs: string;
        sprite: string;
      };
      const config = JSON.parse(
        (await get(t.app, "/api/config", { host, "accept-encoding": "identity" })).body.toString(),
      ) as {
        mapStyles: { light: string };
      };
      return [
        style.sources.openmaptiles.tiles[0],
        style.glyphs,
        style.sprite,
        config.mapStyles.light,
      ];
    };
    const additional = await urlsOf(new URL(otherOrigin).host);
    for (const url of additional) expect(url?.startsWith(`${otherOrigin}/`)).toBe(true);
    const unknown = await urlsOf("evil.example");
    for (const url of unknown) expect(url?.startsWith(`${testOrigin}/`)).toBe(true);
  });

  it("serves the styles for the bundle, revalidated by ETag", async () => {
    const light = await get(t.app, "/map/styles/light.json", { "accept-encoding": "gzip" });
    expect(light.status).toBe(200);
    expect(light.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(light.headers["cache-control"]).toBe("no-cache");
    // Mounted after compression: gzip for a client that takes it.
    expect(light.headers["content-encoding"]).toBe("gzip");
    const etag = String(light.headers.etag);
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const style = JSON.parse(gunzipSync(light.body).toString()) as {
      sources: { openmaptiles: { tiles: string[] } };
      glyphs: string;
      sprite: string;
    };
    expect(style.sources.openmaptiles.tiles).toEqual([
      `${testOrigin}/map/tiles/${bundle}/{z}/{x}/{y}.pbf`,
    ]);
    expect(style.glyphs).toBe(
      `${testOrigin}/map/assets/${testAssets.hash}/fonts/{fontstack}/{range}.pbf`,
    );
    expect(style.sprite).toBe(`${testOrigin}/map/assets/${testAssets.hash}/sprites/ofm`);
    const plainStyle = await get(t.app, "/map/styles/light.json", {
      "accept-encoding": "identity",
    });
    expect(plainStyle.headers["content-encoding"]).toBeUndefined();
    const again = await get(t.app, "/map/styles/light.json", { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    const dark = await get(t.app, "/map/styles/dark.json");
    expect(dark.headers.etag).not.toBe(etag);
    expect((await get(t.app, "/map/styles/satellite.json")).status).toBe(404);
  });

  it("serves a tile as the archive stores it: gzipped MVT, immutable, by the bundle's ETag", async () => {
    const tile = await get(t.app, tilePath(bundle, monacoStreets));
    expect(tile.status).toBe(200);
    expect(tile.headers["content-type"]).toBe("application/x-protobuf");
    expect(tile.headers["content-encoding"]).toBe("gzip");
    expect(tile.headers["cache-control"]).toBe(immutable);
    expect(tile.headers.vary).toBe("Accept-Encoding");
    expect(tile.headers.etag).toBe(`"${bundle}"`);
    expect(Number(tile.headers["content-length"])).toBe(tile.body.length);
    expect(gunzipSync(tile.body)).toEqual(
      await libraryTile(monacoStreets.z, monacoStreets.x, monacoStreets.y),
    );
    // The browser's copy is good for as long as the bundle is.
    const cached = await get(t.app, tilePath(bundle, monacoStreets), {
      "if-none-match": `"${bundle}"`,
    });
    expect(cached.status).toBe(304);
    expect(cached.body.length).toBe(0);
  });

  it("answers 406, uncached, to a client that takes no gzip: a tile is never inflated", async () => {
    const plain = await get(t.app, tilePath(bundle, monacoStreets), {
      "accept-encoding": "identity",
    });
    expect(plain.status).toBe(406);
    expect(plain.headers["cache-control"]).toBe("no-store");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.headers.etag).toBeUndefined();
    const any = await get(t.app, tilePath(bundle, monacoStreets), { "accept-encoding": "*" });
    expect(any.status).toBe(200);
    expect(any.headers["content-encoding"]).toBe("gzip");
    expect(any.headers["cache-control"]).toBe(immutable);
  });

  it("answers 204 outside the archives, cached as long as a tile", async () => {
    const empty = await get(t.app, tilePath(bundle, farAway));
    expect(empty.status).toBe(204);
    expect(empty.body.length).toBe(0);
    expect(empty.headers["cache-control"]).toBe(immutable);
    expect(empty.headers.etag).toBe(`"${bundle}"`);
    // z0–4 come from the region while the volume has no world overview.
    expect((await get(t.app, tilePath(bundle, { z: 0, x: 0, y: 0 }))).status).toBe(200);
  });

  it("answers 410 to a bundle that is not served", async () => {
    const answer = await get(t.app, tilePath("ffffffffffffffff", monacoStreets));
    expect(answer.status).toBe(410);
    expect(answer.headers["cache-control"]).toBe("no-store");
  });

  it("answers 404 to a malformed bundle and to anything that is not a tile of the grid", async () => {
    for (const path of [
      tilePath("FFFFFFFFFFFFFFFF", monacoStreets),
      tilePath(`${bundle}0`, monacoStreets),
      `/map/tiles/${bundle}/15/17060/11948.pbf`,
      `/map/tiles/${bundle}/2/4/0.pbf`,
      `/map/tiles/${bundle}/014/8530/5974.pbf`,
      `/map/tiles/${bundle}/14/8530/5974.mvt`,
      `/map/tiles/${bundle}/14/8530/5974.pbf/more`,
      `/map/tiles/${bundle}/14/..%2F..%2F/5974.pbf`,
      `/map/tiles/..%2F..%2Fregions/14/8530/5974.pbf`,
      "/map/tiles",
      "/map/regions/monaco/20261027/basemap.pmtiles",
      "/map/",
    ]) {
      const answer = await get(t.app, path);
      expect(answer.status, path).toBe(404);
      expect(answer.headers["cache-control"], path).toBe("no-store");
      expect(answer.headers["content-type"], path).toBe("text/plain; charset=utf-8");
    }
  });

  it("serves the fonts and sprites the styles name, and nothing else", async () => {
    const glyphs = await get(
      t.app,
      `/map/assets/${testAssets.hash}/fonts/Noto%20Sans%20Regular/0-255.pbf`,
    );
    expect(glyphs.status).toBe(200);
    expect(glyphs.headers["content-type"]).toBe("application/x-protobuf");
    expect(glyphs.headers["cache-control"]).toBe(immutable);
    expect(glyphs.body).toEqual(testAssets.glyphs);
    // Whole files only: a range request gets the file.
    const ranged = await get(
      t.app,
      `/map/assets/${testAssets.hash}/fonts/Noto%20Sans%20Bold/0-255.pbf`,
      {
        range: "bytes=0-3",
      },
    );
    expect(ranged.status).toBe(200);
    expect(ranged.headers["accept-ranges"]).toBeUndefined();
    expect(ranged.body).toEqual(testAssets.glyphs);
    const sprite = await get(t.app, `/map/assets/${testAssets.hash}/sprites/ofm@2x.json`);
    expect(sprite.status).toBe(200);
    expect(sprite.headers["content-type"]).toBe("application/json; charset=utf-8");
    const png = await get(t.app, `/map/assets/${testAssets.hash}/sprites/ofm.png`);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.body).toEqual(testAssets.png);

    for (const path of [
      `/map/assets/0000000000000000/fonts/Noto%20Sans%20Regular/0-255.pbf`,
      `/map/assets/${testAssets.hash}/fonts/Arial/0-255.pbf`,
      `/map/assets/${testAssets.hash}/fonts/Noto%20Sans%20Regular/256-511.pbf`,
      `/map/assets/${testAssets.hash}/fonts/Noto%20Sans%20Regular/1-256.pbf`,
      `/map/assets/${testAssets.hash}/fonts/..%2F..%2F..%2Fassets.json/0-255.pbf`,
      `/map/assets/${testAssets.hash}/fonts/Noto%20Sans%20Regular/..%2F..%2F..%2Fassets.json`,
      `/map/assets/${testAssets.hash}/sprites/other.png`,
      `/map/assets/${testAssets.hash}/sprites/..%2F..%2Fassets.json`,
      `/map/assets/${testAssets.hash}/assets.json`,
      "/map/assets/assets.json",
      "/map-assets/assets.json",
    ]) {
      expect((await get(t.app, path)).status, path).toBe(404);
    }
  });

  it("switches to a new build at the next look, and serves the bundle before it on", async () => {
    const before = bundle;
    const next = placeBuild(volume, "monaco", {
      buildId: "20261124",
      files: { "basemap.pmtiles": monacoBasemap },
    });
    await t.ctx.basemap.rescan();
    const now = t.ctx.basemap.state();
    expect(now.region).toBe(`monaco ${next.name}`);
    expect(now.bundle).not.toBe(before);
    const style = JSON.parse(
      gunzipSync(
        (await get(t.app, "/map/styles/dark.json", { "accept-encoding": "gzip" })).body,
      ).toString(),
    ) as {
      sources: { openmaptiles: { tiles: string[] } };
    };
    expect(style.sources.openmaptiles.tiles[0]).toContain(`/map/tiles/${now.bundle}/`);
    // A map opened before the switch keeps loading its tiles.
    expect((await get(t.app, tilePath(before, monacoStreets))).status).toBe(200);
    expect((await get(t.app, tilePath(now.bundle ?? "", monacoStreets))).status).toBe(200);
    bundle = now.bundle ?? "";
  });
});

describe("the basemap without a build on the volume", () => {
  let webDist: string;

  beforeAll(() => {
    webDist = webDistWithAssets();
  });

  afterAll(() => {
    rmSync(webDist, { recursive: true, force: true });
  });

  it("falls back to the external styles and lets the CSP reach them", async () => {
    const fallback = await createTestContext({
      env: { MAP_DATA_DIR: emptyVolume(), MAP_BASEMAP_REGION: "monaco" },
      webDistDir: webDist,
    });
    try {
      const config = await get(fallback.app, "/api/config");
      expect(JSON.parse(config.body.toString()).mapStyles).toEqual({
        light: "https://tiles.openfreemap.org/styles/liberty",
        dark: "https://tiles.openfreemap.org/styles/dark",
        basemap: "external",
      });
      expect(String(config.headers["content-security-policy"])).toContain(
        "connect-src 'self' https://tiles.openfreemap.org;",
      );
      const health = JSON.parse((await get(fallback.app, "/api/health")).body.toString());
      expect(health.basemap).toBe("external");
      // A map that still asks for the own styles gets the plain ground, and no tile.
      const style = JSON.parse((await get(fallback.app, "/map/styles/light.json")).body.toString());
      expect(style.sources).toEqual({});
      expect((await get(fallback.app, tilePath(unknownBundle, monacoStreets))).status).toBe(410);
    } finally {
      await fallback.close();
    }
  });

  it("draws a plain ground with the fallback off, and keeps the map origins at 'self'", async () => {
    const plain = await createTestContext({
      env: {
        MAP_DATA_DIR: emptyVolume(),
        MAP_BASEMAP_REGION: "monaco",
        MAP_BASEMAP_FALLBACK: "false",
      },
      webDistDir: webDist,
    });
    try {
      const config = await get(plain.app, "/api/config");
      expect(JSON.parse(config.body.toString()).mapStyles).toEqual({
        light: `${testOrigin}/map/styles/light.json`,
        dark: `${testOrigin}/map/styles/dark.json`,
        basemap: "none",
      });
      expect(String(config.headers["content-security-policy"])).toContain("connect-src 'self';");
      const style = JSON.parse((await get(plain.app, "/map/styles/dark.json")).body.toString());
      expect(style).toMatchObject({ sources: {}, metadata: { "trail:basemap": "none" } });
    } finally {
      await plain.close();
    }
  });

  it("uses the external styles always with MAP_BASEMAP=openfreemap", async () => {
    const volume = emptyVolume();
    placeBuild(volume, "monaco", {
      buildId: "20261027",
      files: { "basemap.pmtiles": monacoBasemap },
    });
    const external = await createTestContext({
      env: { MAP_DATA_DIR: volume, MAP_BASEMAP_REGION: "monaco", MAP_BASEMAP: "openfreemap" },
      webDistDir: webDist,
    });
    try {
      const config = JSON.parse((await get(external.app, "/api/config")).body.toString());
      expect(config.mapStyles.basemap).toBe("external");
      expect(config.mapStyles.light).toBe("https://tiles.openfreemap.org/styles/liberty");
    } finally {
      await external.close();
      rmSync(volume, { recursive: true, force: true });
    }
  });

  it("keeps the external origins in the CSP with the fallback on, also while Trail serves its own build", async () => {
    const app = await startApp();
    try {
      expect(app.t.ctx.basemap.state().source).toBe("self");
      const config = await get(app.t.app, "/api/config");
      expect(String(config.headers["content-security-policy"])).toContain(
        "connect-src 'self' https://tiles.openfreemap.org;",
      );
    } finally {
      await stopApp(app);
    }
  });
});

describe("the basemap's own rate limit", () => {
  it("limits /map per address on its own, and never counts against /api", async () => {
    const app = await startApp({
      env: { RATE_LIMIT_MAP_PER_MINUTE: "3", RATE_LIMIT_API_PER_MINUTE: "2" },
    });
    const limited = app.t;
    try {
      const id = app.bundle;
      for (let index = 0; index < 3; index += 1) {
        expect((await get(limited.app, tilePath(id, monacoStreets))).status).toBe(200);
      }
      const refused = await get(limited.app, tilePath(id, monacoStreets));
      expect(refused.status).toBe(429);
      expect(String(refused.headers["ratelimit-policy"])).toContain('"map"');
      // The API's budget is untouched by the map's requests.
      expect((await get(limited.app, "/api/missing")).status).toBe(404);
    } finally {
      await stopApp(app);
    }
  });
});
