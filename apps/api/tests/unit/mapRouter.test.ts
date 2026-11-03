import { gzipSync } from "node:zlib";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Basemap } from "../../src/basemap/basemap";
import { ArchiveClosedError, ArchiveError } from "../../src/basemap/basemapArchive";
import type { BasemapBundle } from "../../src/basemap/basemapBundle";
import { mapRouter } from "../../src/basemap/mapRouter";
import { createLogger } from "../../src/logging/createLogger";

const id = "0123456789abcdef";
const tileUrl = `/map/tiles/${id}/5/16/10.pbf`;
const gzipped = gzipSync(Buffer.from("a vector tile"));
const immutable = "public, max-age=31536000, immutable";

/** A router over a bundle whose region archive answers as `read` says. */
function appOver(read: () => Promise<unknown>) {
  const archive = { acquire: () => () => {}, tile: read };
  const bundle = { id, region: { archive }, world: null } as unknown as BasemapBundle;
  const basemap = { bundle: (name: string) => (name === id ? bundle : null) } as unknown as Basemap;
  const { tiles, documents } = mapRouter({
    basemap,
    logger: createLogger({ level: "silent" }),
    perMinute: 100_000,
  });
  return express().set("etag", false).use("/map", tiles, documents);
}

const stored = async () => ({ data: gzipped, compression: "gzip" });

describe("a tile, never inflated on the request path", () => {
  it("sends the stored gzip bytes to a client that takes gzip, or anything", async () => {
    for (const accept of ["gzip", "br, gzip;q=0.5", "*"]) {
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
    for (const accept of ["identity", "gzip;q=0"]) {
      const answer = await request(appOver(stored)).get(tileUrl).set("Accept-Encoding", accept);
      expect(answer.status, accept).toBe(406);
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect(answer.headers["content-encoding"]).toBeUndefined();
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

  it("answers 404 with no-store for an archive that was closed", async () => {
    const answer = await request(appOver(() => Promise.reject(new ArchiveClosedError())))
      .get(tileUrl)
      .set("Accept-Encoding", "gzip");
    expect(answer.status).toBe(404);
    expect(answer.headers["cache-control"]).toBe("no-store");
  });
});
