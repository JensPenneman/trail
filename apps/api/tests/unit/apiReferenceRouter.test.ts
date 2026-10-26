import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiPaths } from "@trail/contracts/apiPaths";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { apiReferenceRouter } from "../../src/apiReference/apiReferenceRouter";
import { createLogger } from "../../src/logging/createLogger";

const logger = createLogger({ level: "silent" });
const dir = mkdtempSync(join(tmpdir(), "trail-api-reference-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A bundle of its own (the scripts are kept per path), big enough to be compressed. */
function bundle(name: string): string {
  const path = join(dir, name);
  writeFileSync(path, `/* ${name} */ ${"globalThis.Scalar = {};\n".repeat(200)}`);
  return path;
}

function appFor(bundlePath: string): Express {
  const router = apiReferenceRouter(bundlePath, logger);
  if (router === null) throw new Error(`no reference for ${bundlePath}`);
  const app = express();
  app.use(apiPaths.docs, router);
  return app;
}

/** The address of the page's Scalar bundle. */
const bundleUrl = async (app: Express): Promise<string> => {
  const page = await request(app).get(apiPaths.docs).expect(200);
  return /src="([^"]*\/scalar-[0-9a-f]{12}\.js)"/.exec(page.text)?.[1] ?? "";
};

describe("the API reference router", () => {
  it("reads the bundle when it is created, not on the first request", async () => {
    const path = bundle("startup.js");
    const app = appFor(path);
    // Gone before anyone asked: what the page serves comes from memory.
    rmSync(path);
    const script = await request(app)
      .get(await bundleUrl(app))
      .expect(200);
    expect(script.text).toContain("/* startup.js */");
  });

  it("answers a revalidation of a script with 304 and its ETag, before compressing", async () => {
    const app = appFor(bundle("etag.js"));
    const url = await bundleUrl(app);
    const first = await request(app).get(url).set("Accept-Encoding", "identity").expect(200);
    const etag = String(first.headers["etag"]);
    expect(etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    for (const encoding of ["identity", "br", "gzip"]) {
      const again = await request(app)
        .get(url)
        .set("Accept-Encoding", encoding)
        .set("If-None-Match", etag)
        .expect(304);
      expect(again.headers["etag"], encoding).toBe(etag);
      expect(again.headers["content-encoding"], encoding).toBeUndefined();
      expect(again.headers["cache-control"], encoding).toBe("public, max-age=31536000, immutable");
    }
    await request(app).get(url).set("If-None-Match", 'W/"other"').expect(200);
  });

  it("serves no page when the bundle cannot be read", () => {
    // A directory where the file should be: reading it fails.
    expect(apiReferenceRouter(dir, logger)).toBeNull();
    expect(apiReferenceRouter(null, logger)).toBeNull();
  });
});
