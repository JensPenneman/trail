import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runtimePaths } from "../../src/runtimePaths";

describe("runtimePaths", () => {
  // The Dockerfile's build-time stage copies the stamp into apps/api/dist, next to
  // the bundle: this is the only link between the image and the API.
  it("reads the build time from a file named build-time next to the bundle", () => {
    const bundle = join("/app", "apps", "api", "dist", "main.mjs");
    const { buildTimeFile } = runtimePaths(pathToFileURL(bundle).href);
    expect(buildTimeFile).toBe(join("/app", "apps", "api", "dist", "build-time"));
    expect(basename(buildTimeFile)).toBe("build-time");
    expect(dirname(buildTimeFile)).toBe(dirname(bundle));
  });
});
