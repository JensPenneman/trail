import { readFileSync } from "node:fs";
import { apiPaths } from "@trail/contracts/apiPaths";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiReferenceScriptPath } from "../../src/packagedFiles";
import { resetDatabase } from "../support/resetDatabase";
import { createTestContext, type TestContext } from "../support/testContext";

let t: TestContext;

beforeAll(async () => {
  await resetDatabase();
  t = await createTestContext();
});

afterAll(async () => {
  await t.close();
});

const docsCsp =
  "default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;" +
  "connect-src 'self';worker-src 'self' blob:;child-src 'self' blob:;font-src 'self';" +
  "manifest-src 'self';object-src 'none';base-uri 'none';form-action 'self';frame-ancestors 'none'";

/** The page's script URLs, in page order (every one is a `/docs/assets/…` file). */
const scriptPaths = (html: string): string[] =>
  [...html.matchAll(/src="(\/docs\/assets\/[^"]+)"/g)].map((match) => match[1] ?? "");

describe("/docs", () => {
  it("is a page of its own with a CSP that allows inline styles, and nothing inline else", async () => {
    const page = await request(t.app).get(apiPaths.docs).expect(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["cache-control"]).toBe("no-cache");
    expect(page.headers["content-security-policy"]).toBe(docsCsp);
    expect(page.headers["x-frame-options"]).toBe("DENY");
    for (const inline of ["<script>", "<style", "style="]) expect(page.text).not.toContain(inline);
    const scripts = scriptPaths(page.text);
    expect(scripts.map((path) => path.replace(/-[0-9a-f]{12}\.js$/, ""))).toEqual([
      "/docs/assets/setup",
      "/docs/assets/scalar",
      "/docs/assets/start",
    ]);
    const secure = await request(t.app)
      .get(apiPaths.docs)
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    expect(secure.headers["content-security-policy"]).toBe(`${docsCsp};upgrade-insecure-requests`);
  });

  it("serves its scripts from the server, immutable and compressed once", async () => {
    const page = await request(t.app).get(apiPaths.docs).expect(200);
    const [setup = "", bundle = "", start = ""] = scriptPaths(page.text);
    for (const path of [setup, bundle, start]) {
      const response = await request(t.app).get(path).expect(200);
      expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
      expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    }
    const setupScript = await request(t.app).get(setup).expect(200);
    expect(setupScript.text).toContain("jitless: true");
    const startScript = await request(t.app).get(start).expect(200);
    expect(startScript.text).toContain(`"url":"${apiPaths.v1.openApi}"`);
    expect(startScript.text).toContain('"withDefaultFonts":false');

    const original = readFileSync(apiReferenceScriptPath() ?? "");
    const brotli = await request(t.app)
      .get(bundle)
      .set("Accept-Encoding", "br, gzip")
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(brotli.headers["content-encoding"]).toBe("br");
    expect(Number(brotli.headers["content-length"])).toBeLessThan(original.length / 3);
    const gzipped = await request(t.app).get(bundle).set("Accept-Encoding", "gzip").expect(200);
    expect(gzipped.headers["content-encoding"]).toBe("gzip");
    expect(Buffer.from(gzipped.text).equals(original)).toBe(true);
  });

  it("knows nothing else", async () => {
    for (const path of ["/docs/assets/scalar-000000000000.js", "/docs/other", "/docs/assets/"]) {
      const response = await request(t.app).get(path).expect(404);
      expect(response.headers["content-type"]).toMatch(/^text\/plain/);
    }
  });
});
