import { join } from "node:path";
import { gzipSync } from "node:zlib";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Basemap } from "../../src/basemap/basemap";
import { ArchiveClosedError, ArchiveError } from "../../src/basemap/basemapArchive";
import type { BasemapBundle } from "../../src/basemap/basemapBundle";
import { readMapAssets } from "../../src/basemap/mapAssets";
import { mapRouter } from "../../src/basemap/mapRouter";
import { createLogger } from "../../src/logging/createLogger";
import { testAssets, webDistWithAssets } from "../support/basemapVolume";

const id = "0123456789abcdef";
const tileUrl = `/map/tiles/${id}/5/16/10.pbf`;
const gzipped = gzipSync(Buffer.from("a vector tile"));
const immutable = "public, max-age=31536000, immutable";

/** A router over a bundle whose region archive answers as `read` says. */
function appOver(read: () => Promise<unknown>, served: string = id) {
  const archive = { acquire: () => () => {}, tile: read };
  const bundle = { id, region: { archive }, world: null } as unknown as BasemapBundle;
  const basemap = {
    bundle: (name: string) => (name === served ? bundle : null),
  } as unknown as Basemap;
  const { tiles, documents } = mapRouter({
    basemap,
    logger: createLogger({ level: "silent" }),
    perMinute: 100_000,
    allowedOrigins: ["https://trail.example"],
    publicUrl: "https://trail.example",
  });
  return express().set("etag", false).use("/map", tiles, documents);
}

const stored = async () => ({ data: gzipped, compression: "gzip" });

describe("a tile, never inflated on the request path", () => {
  it("sends the stored gzip bytes to a client that takes gzip, or anything", async () => {
    for (const accept of ["gzip", "x-gzip", "br, gzip;q=0.5", "*", "gzip;q=0, *;q=0.5, x-gzip"]) {
      const answer = await request(appOver(stored))
        .get(tileUrl)
        .set("Accept-Encoding", accept)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        });
      expect(answer.status, accept).toBe(200);
      expect(answer.headers["content-encoding"]).toBe("gzip");
      expect(answer.headers["cache-control"]).toBe(immutable);
      expect(answer.headers["vary"]).toBe("Accept-Encoding");
      expect(answer.headers["content-type"]).toBe("application/x-protobuf");
      // The client inflates what the header says; the bytes sent were the stored ones.
      expect(answer.body).toEqual(Buffer.from("a vector tile"));
    }
  });

  it("answers 406, uncached, to a client that takes no gzip", async () => {
    for (const accept of ["identity", "gzip;q=0", "*;q=0", "br, gzip;q=0, *"]) {
      const answer = await request(appOver(stored)).get(tileUrl).set("Accept-Encoding", accept);
      expect(answer.status, accept).toBe(406);
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect(answer.headers["content-encoding"]).toBeUndefined();
    }
  });
});

describe("a tile of a request without Accept-Encoding", () => {
  it("is the stored gzip tile: any coding is acceptable (RFC 9110 §12.5.3)", async () => {
    // supertest sends no Accept-Encoding of its own.
    const answer = await request(appOver(stored)).get(tileUrl);
    expect(answer.status).toBe(200);
    expect(answer.headers["content-encoding"]).toBe("gzip");
  });
});

describe("a tile of a bundle that is no longer served", () => {
  it("answers 410 with no-store for a well-formed id, 404 for a malformed one", async () => {
    const app = appOver(stored, "ffffffffffffffff");
    const gone = await request(app).get(tileUrl).set("Accept-Encoding", "gzip");
    expect(gone.status).toBe(410);
    expect(gone.headers["cache-control"]).toBe("no-store");
    expect(gone.headers["etag"]).toBeUndefined();
    for (const path of ["/map/tiles/0123456789ABCDEF/5/16/10.pbf", "/map/tiles/abc/5/16/10.pbf"]) {
      const malformed = await request(app).get(path);
      expect(malformed.status, path).toBe(404);
    }
  });
});

describe("a tile URL that names no bundle", () => {
  it("is answered without the bundle registry or the archive being asked for it", async () => {
    const read = vi.fn(stored);
    const archive = { acquire: () => () => {}, tile: read };
    const bundle = { id, region: { archive }, world: null } as unknown as BasemapBundle;
    const lookup = vi.fn((name: string) => (name === id ? bundle : null));
    const { tiles, documents } = mapRouter({
      basemap: { bundle: lookup } as unknown as Basemap,
      logger: createLogger({ level: "silent" }),
      perMinute: 100_000,
      allowedOrigins: ["https://trail.example"],
      publicUrl: "https://trail.example",
    });
    const app = express().set("etag", false).use("/map", tiles, documents);
    for (const path of [
      `/map/tiles/..%2F..%2Fetc%2Fpasswd/5/16/10.pbf`,
      `/map/tiles/%2e%2e/5/16/10.pbf`,
      `/map/tiles/%2e%2e%2f%2e%2e%2f%2e%2e%2f/5/16/10.pbf`,
      `/map/tiles/${"a".repeat(64)}/5/16/10.pbf`,
      `/map/tiles/${id.slice(1)}/5/16/10.pbf`,
      `/map/tiles/${id}0/5/16/10.pbf`,
      `/map/tiles/000000000000000g/5/16/10.pbf`,
      `/map/tiles/${id}/-1/16/10.pbf`,
      `/map/tiles/${id}/5/-16/10.pbf`,
      `/map/tiles/${id}/5/16/-10.pbf`,
      `/map/tiles/${id}/99/16/10.pbf`,
      `/map/tiles/${id}/5/99999999999/10.pbf`,
      `/map/tiles/${id}/5/16/99999999999.pbf`,
      `/map/tiles/${id}/5/16/10.pbf%00`,
      `/map/tiles/${id}/5/16/..%2F10.pbf`,
      `/map/tiles/${id}/05/16/10.pbf`,
      `/map/tiles/${id}/5/32/10.pbf`,
    ]) {
      const answer = await request(app).get(path).set("Accept-Encoding", "gzip");
      expect([400, 404], path).toContain(answer.status);
      expect(answer.headers["cache-control"], path).toBe("no-store");
    }
    // No request-derived string reached the registry, and no tile was read.
    expect(lookup).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    // The one well-formed request does look the id up, and nothing else does.
    expect((await request(app).get(tileUrl).set("Accept-Encoding", "gzip")).status).toBe(200);
    expect(lookup.mock.calls).toEqual([[id]]);
  });
});

describe("an asset URL the registry does not list", () => {
  it("answers 404 with no-store, and the lookups were asked exactly what the URL named", async () => {
    const fontFile = vi.fn((_stack: string, _file: string): string | null => null);
    const spriteFile = vi.fn((_file: string): string | null => null);
    const basemap = {
      bundle: () => null,
      assets: { hash: "0123456789abcdef", fontFile, spriteFile },
    } as unknown as Basemap;
    const { tiles, documents } = mapRouter({
      basemap,
      logger: createLogger({ level: "silent" }),
      perMinute: 100_000,
      allowedOrigins: ["https://trail.example"],
      publicUrl: "https://trail.example",
    });
    const app = express().set("etag", false).use("/map", tiles, documents);
    const base = "/map/assets/0123456789abcdef";
    const font = await request(app).get(`${base}/fonts/Noto%20Sans%20Regular/0-255.pbf`);
    const traversal = await request(app).get(`${base}/fonts/%2e%2e/%2e%2e%2fx.pbf`);
    const png = await request(app).get(`${base}/sprites/nope.png`);
    const json = await request(app).get(`${base}/sprites/nope.json`);
    for (const answer of [font, traversal, png, json]) {
      expect(answer.status).toBe(404);
      expect(answer.headers["cache-control"]).toBe("no-store");
    }
    expect(fontFile.mock.calls).toEqual([
      ["Noto Sans Regular", "0-255.pbf"],
      ["..", "../x.pbf"],
    ]);
    // The PNG route passes on to the document router, which asks again for the JSON ones.
    expect(spriteFile.mock.calls.map(([name]) => name)).toContain("nope.json");
    expect(spriteFile.mock.calls.map(([name]) => name)).toContain("nope.png");
  });
});

describe("a style URL", () => {
  it("answers 404 with no-store for names an object has but the styles do not", async () => {
    const app = appOver(stored);
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "other.json"]) {
      const answer = await request(app).get(`/map/styles/${name}`);
      expect(answer.status, name).toBe(404);
      expect(answer.headers["cache-control"], name).toBe("no-store");
    }
  });
});

describe("the map assets", () => {
  it("name the files they were read with, and nothing a request makes up", () => {
    const dist = webDistWithAssets();
    const assets = readMapAssets(dist);
    if (assets === null) throw new Error("no assets read");
    const stack = testAssets.fonts[2];
    const glyphs = assets.fontFile(stack ?? "", "0-255.pbf");
    expect(glyphs).toBe(
      join(dist, "map-assets", testAssets.hash, "fonts", stack ?? "", "0-255.pbf"),
    );
    expect(assets.spriteFile("ofm.json")).toBe(
      join(dist, "map-assets", testAssets.hash, "sprites", "ofm.json"),
    );
    for (const [s, f] of [
      ["..", "0-255.pbf"],
      [stack ?? "", "../0-255.pbf"],
      [stack ?? "", "..%2F0-255.pbf"],
      [stack ?? "", "256-511.pbf"],
      [stack ?? "", "assets.json"],
      ["", "0-255.pbf"],
      ["Arial", "0-255.pbf"],
    ] as const) {
      expect(assets.fontFile(s, f), `${s}/${f}`).toBeNull();
    }
    for (const f of ["../assets.json", "other.png", "ofm.json/", "OFM.JSON", ""]) {
      expect(assets.spriteFile(f), f).toBeNull();
    }
  });
});

describe("a tile whose archive fails", () => {
  it("answers 5xx with no-store, never immutable", async () => {
    const answer = await request(appOver(() => Promise.reject(new ArchiveError("broken"))))
      .get(tileUrl)
      .set("Accept-Encoding", "gzip");
    expect(answer.status).toBeGreaterThanOrEqual(500);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(answer.headers["etag"]).toBeUndefined();
  });

  it("answers 410 with no-store for an archive that was closed", async () => {
    const answer = await request(appOver(() => Promise.reject(new ArchiveClosedError())))
      .get(tileUrl)
      .set("Accept-Encoding", "gzip");
    expect(answer.status).toBe(410);
    expect(answer.headers["cache-control"]).toBe("no-store");
  });
});
