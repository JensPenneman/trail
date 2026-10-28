import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkTrailManifest,
  isBuildId,
  readArtefactLayout,
} from "../../src/mapdata/artefactLayout";
import { parseChallenge, type ResolvedManifest } from "../../src/mapdata/registry";
import { parseRegistryCredentials } from "../../src/mapdata/registryCredentials";
import { RegistryError } from "../../src/mapdata/registryError";
import { parseRegistryReference, registryHosts } from "../../src/mapdata/registryReference";
import { monacoFixture } from "../support/fakeRegistry";

/**
 * The manifest the Map data workflow published as
 * ghcr.io/jenspenneman/trail-mapdata:monaco-20261027 (run 40675644151),
 * byte for byte, as GHCR serves it: its layer manifest.json is the fixture's.
 */
const published =
  '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","artifactType":"application/vnd.trail.mapdata.v1","config":{"mediaType":"application/vnd.oci.empty.v1+json","digest":"sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","size":2,"data":"e30="},"layers":[{"mediaType":"application/vnd.trail.mapdata.manifest.v1+json","digest":"sha256:342516f603e92648712dbb2e53969fc5d1eaff0f1967bcca553f64ed6417c47d","size":3329,"annotations":{"org.opencontainers.image.title":"manifest.json"}},{"mediaType":"application/vnd.trail.mapdata.ways.v1+gzip","digest":"sha256:938805824369f4c5b62331d8840a7c6a46139efc0753445ddaebca706ccec6fd","size":240517,"annotations":{"org.opencontainers.image.title":"ways.opl.gz"}},{"mediaType":"application/vnd.trail.mapdata.pois.v1+gzip","digest":"sha256:8dc17a37a94833dee3e963ac8574592f02d3be257778a78fd504fbad3408d1d5","size":3306,"annotations":{"org.opencontainers.image.title":"pois.geojsonseq.gz"}},{"mediaType":"application/vnd.trail.mapdata.poly.v1","digest":"sha256:4b382cbe0add3661ebb37fd59bbd030523543ad88638b2a01ae41abe32124289","size":635,"annotations":{"org.opencontainers.image.title":"region.poly"}},{"mediaType":"application/vnd.trail.mapdata.basemap.v1","digest":"sha256:0562f586c601d7fccdef10c880b43b21b684209cc67cd37378a625e5c687af04","size":421415,"annotations":{"org.opencontainers.image.title":"basemap.pmtiles"}}],"annotations":{"com.jenspenneman.trail.mapdata.build":"20261027","com.jenspenneman.trail.mapdata.region":"monaco","org.opencontainers.image.created":"2026-10-28T10:53:43Z","org.opencontainers.image.description":"Trail map data: monaco (Geofabrik europe/monaco), OSM data up to 2026-10-27T21:23:59Z","org.opencontainers.image.licenses":"ODbL-1.0","org.opencontainers.image.revision":"a09cf458144ed35b57b03a2c5c978b18b68ec0f7","org.opencontainers.image.source":"https://github.com/JensPenneman/trail","org.opencontainers.image.version":"20261027"}}';

const resolve = (text: string): ResolvedManifest => {
  const bytes = Buffer.from(text, "utf8");
  return {
    tag: "monaco",
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    bytes,
    json: JSON.parse(text),
  };
};

const reasonOf = (run: () => unknown): string | null => {
  try {
    run();
  } catch (error) {
    if (error instanceof RegistryError) return error.reason;
    throw error;
  }
  return null;
};

describe("the artefact layout", () => {
  it("reads the manifest the workflow published, and the fixture's manifest.json matches it", () => {
    const resolved = resolve(published);
    expect(resolved.digest).toBe(
      "sha256:72f10f35fce6a0fc760bf32b16b3ead41ce4f70a7734b6749eee056e3dc2e762",
    );
    const layout = readArtefactLayout(resolved, "monaco", 10e9);
    expect(layout).toMatchObject({ region: "monaco", buildId: "20261027", totalBytes: 669_202 });
    expect(layout.manifest).toEqual({
      digest: "sha256:342516f603e92648712dbb2e53969fc5d1eaff0f1967bcca553f64ed6417c47d",
      size: 3329,
    });
    expect(layout.files.map((file) => [file.name, file.bytes, file.layers.length])).toEqual([
      ["ways.opl.gz", 240_517, 1],
      ["pois.geojsonseq.gz", 3306, 1],
      ["region.poly", 635, 1],
      ["basemap.pmtiles", 421_415, 1],
    ]);
    const trail = checkTrailManifest(layout, readFileSync(join(monacoFixture, "manifest.json")));
    expect(trail.extractTimestamp).toBe("2026-10-27T21:23:59Z");
    expect(trail.sha256.get("basemap.pmtiles")).toBe(
      "0562f586c601d7fccdef10c880b43b21b684209cc67cd37378a625e5c687af04",
    );
  });

  it("refuses it for another region, or over the size cap", () => {
    expect(reasonOf(() => readArtefactLayout(resolve(published), "belgium", 10e9))).toBe(
      "malformed",
    );
    expect(reasonOf(() => readArtefactLayout(resolve(published), "monaco", 600_000))).toBe(
      "too_large",
    );
  });

  it("refuses a manifest.json of another build than the manifest's annotations", () => {
    const layout = readArtefactLayout(resolve(published), "monaco", 10e9);
    const manifest = JSON.parse(readFileSync(join(monacoFixture, "manifest.json"), "utf8"));
    manifest.build.id = "20261028";
    expect(reasonOf(() => checkTrailManifest(layout, Buffer.from(JSON.stringify(manifest))))).toBe(
      "malformed",
    );
    expect(reasonOf(() => checkTrailManifest(layout, Buffer.from("not json")))).toBe("malformed");
  });

  it("takes yyyymmdd of a real day as a build id", () => {
    expect(isBuildId("20261027")).toBe(true);
    expect(isBuildId("20240229")).toBe(true);
    for (const value of [
      "20250229",
      "20261332",
      "20261000",
      "2026102",
      "202610277",
      "2026-10-27",
      "",
    ]) {
      expect(isBuildId(value)).toBe(false);
    }
  });
});

describe("the registry's name and its hosts", () => {
  it("reads a host and a repository, nothing else", () => {
    expect(parseRegistryReference("ghcr.io/jenspenneman/trail-mapdata")).toEqual({
      host: "ghcr.io",
      repository: "jenspenneman/trail-mapdata",
    });
    expect(parseRegistryReference(" Registry.Example.com:5000/maps/trail ")).toEqual({
      host: "registry.example.com:5000",
      repository: "maps/trail",
    });
    expect(parseRegistryReference("localhost/trail-mapdata")).toEqual({
      host: "localhost",
      repository: "trail-mapdata",
    });
    for (const value of [
      "https://ghcr.io/jenspenneman/trail-mapdata",
      "ghcr.io/jenspenneman/trail-mapdata:belgium",
      "ghcr.io/jenspenneman/trail-mapdata@sha256:00",
      "ghcr.io",
      "ghcr.io/",
      "jenspenneman/trail-mapdata",
      "ghcr.io/Jens/Trail",
      "ghcr.io/jens/../trail",
      "ghcr.io:99999/trail",
      "ghcr.io/trail mapdata",
    ]) {
      expect(parseRegistryReference(value)).toBeNull();
    }
  });

  it("pins GHCR to its blob host and any other registry to itself", () => {
    expect(registryHosts({ host: "ghcr.io", repository: "jenspenneman/trail-mapdata" })).toEqual({
      api: "ghcr.io",
      blobs: ["ghcr.io", "pkg-containers.githubusercontent.com"],
    });
    expect(registryHosts({ host: "registry.example.com:5000", repository: "maps" })).toEqual({
      api: "registry.example.com:5000",
      blobs: ["registry.example.com:5000"],
    });
  });

  it("reads the challenge of a registry", () => {
    const challenge = parseChallenge(
      'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:jenspenneman/trail:pull"',
    );
    expect(challenge?.scheme).toBe("bearer");
    expect(Object.fromEntries(challenge?.params ?? [])).toEqual({
      realm: "https://ghcr.io/token",
      service: "ghcr.io",
      scope: "repository:jenspenneman/trail:pull",
    });
    expect(parseChallenge('Basic realm="Registry \\"home\\""')?.params.get("realm")).toBe(
      'Registry "home"',
    );
    expect(parseChallenge(null)).toBeNull();
    expect(parseChallenge('Bearer realm="unterminated')).toBeNull();
    expect(parseChallenge(`Bearer realm="${"x".repeat(5000)}"`)).toBeNull();
  });

  it("reads <user>:<token> and nothing else", () => {
    expect(parseRegistryCredentials("jens:ghp_abc")?.username).toBe("jens");
    expect(parseRegistryCredentials("jens:a:b")?.username).toBe("jens");
    for (const value of [
      "ghp_abc",
      ":ghp_abc",
      "jens:",
      "jens:ghp abc",
      "je ns:ghp",
      "jens:ghp\n",
    ]) {
      expect(parseRegistryCredentials(value)).toBeNull();
    }
    const basic = parseRegistryCredentials("jens:a:b")?.basicAuthorization();
    expect(basic).toBe(`Basic ${Buffer.from("jens:a:b").toString("base64")}`);
  });
});
