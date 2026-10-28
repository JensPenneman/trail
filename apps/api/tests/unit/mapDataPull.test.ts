import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { inspect } from "node:util";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/logging/createLogger";
import { readArtefactLayout } from "../../src/mapdata/artefactLayout";
import type { BlobSource } from "../../src/mapdata/downloadBlob";
import { listLocalBuilds } from "../../src/mapdata/localBuilds";
import { pullBuild } from "../../src/mapdata/pullBuild";
import { RegistryClient } from "../../src/mapdata/registry";
import {
  parseRegistryCredentials,
  type RegistryCredentials,
} from "../../src/mapdata/registryCredentials";
import { RegistryError } from "../../src/mapdata/registryError";
import {
  type FakeArtefact,
  FakeRegistry,
  makeArtefact,
  monacoFiles,
  monacoFixture,
} from "../support/fakeRegistry";

const silent = createLogger({ level: "silent" });
const never = new AbortController().signal;
const noWait = async () => {};

let fake: FakeRegistry;
let root: string;

beforeEach(async () => {
  fake = await new FakeRegistry().start();
  root = await mkdtemp(join(tmpdir(), "trail-mapdata-"));
});

afterEach(async () => {
  await fake.close();
  await rm(root, { recursive: true, force: true });
});

function clientFor(options: { credentials?: RegistryCredentials | null; logger?: Logger } = {}) {
  return new RegistryClient({
    reference: { host: fake.host, repository: fake.repository },
    credentials: options.credentials ?? null,
    logger: options.logger ?? silent,
    scheme: "http",
    blobHosts: [fake.blobHost],
    headersTimeoutMs: 5000,
    wait: noWait,
  });
}

async function pull(
  region: string,
  options: {
    client?: RegistryClient;
    source?: BlobSource;
    maxBytes?: number;
    freeBytes?: number;
  } = {},
) {
  const client = options.client ?? clientFor();
  const resolved = await client.resolve(region, never);
  const layout = readArtefactLayout(resolved, region, options.maxBytes ?? 1e9);
  return pullBuild({
    source: options.source ?? client,
    resolved,
    layout,
    root,
    signal: never,
    logger: silent,
    download: { attempts: 3, idleTimeoutMs: 5000, wait: noWait },
    freeBytes: async () => options.freeBytes ?? 1e12,
  });
}

/** The reason a pull failed with. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RegistryError) return error.reason;
    throw error;
  }
  throw new Error("expected the pull to be refused");
}

const monaco = (overrides: Partial<Parameters<typeof makeArtefact>[0]> = {}): FakeArtefact =>
  makeArtefact({ region: "monaco", buildId: "20261027", files: monacoFiles(), ...overrides });

const fixtureFile = (name: string) => readFile(join(monacoFixture, name));

async function downloadsLeft(): Promise<string[]> {
  return readdir(join(root, "tmp")).catch(() => []);
}

describe("pulling a build from the registry", () => {
  it("puts every file into regions/<region>/<build>-<digest>/, as the artefact holds it", async () => {
    const artefact = monaco();
    fake.publish(artefact);
    const build = await pull("monaco");
    expect(build.name).toBe(`20261027-${artefact.digest.slice(7, 15)}`);
    expect(build.dir).toBe(join(root, "regions", "monaco", build.name));
    expect(build).toMatchObject({ region: "monaco", buildId: "20261027", digest: artefact.digest });
    for (const name of ["ways.opl.gz", "pois.geojsonseq.gz", "region.poly", "basemap.pmtiles"]) {
      expect(await readFile(join(build.dir, name))).toEqual(await fixtureFile(name));
    }
    expect(await readFile(join(build.dir, "manifest.json"))).toEqual(artefact.trailManifest);
    expect(await readFile(join(build.dir, "oci-manifest.json"))).toEqual(artefact.manifest);
    expect((await readdir(build.dir)).sort()).toEqual([
      "basemap.pmtiles",
      "manifest.json",
      "oci-manifest.json",
      "pois.geojsonseq.gz",
      "region.poly",
      "ways.opl.gz",
    ]);
    expect(await downloadsLeft()).toEqual([]);
    expect(await listLocalBuilds(root, "monaco")).toEqual([
      expect.objectContaining({
        digest: artefact.digest,
        extractTimestamp: "2026-10-27T21:23:59Z",
      }),
    ]);
  });

  it("follows the redirect to the blob host without the registry's token", async () => {
    fake.publish(monaco());
    await pull("monaco");
    const blobs = fake.requests.filter((request) => request.server === "blobs");
    expect(blobs).toHaveLength(5);
    expect(blobs.every((request) => request.authorization === null)).toBe(true);
    const api = fake.requests.filter(
      (request) => request.server === "registry" && request.path.startsWith("/v2/"),
    );
    // The first request is the challenge; every other one carries the token.
    expect(api[0]?.authorization).toBeNull();
    expect(api.slice(1).every((request) => request.authorization?.startsWith("Bearer "))).toBe(
      true,
    );
  });

  it("puts chunked files together and checks them", async () => {
    const artefact = monaco({ chunkBytes: 100_000 });
    expect(artefact.layers.map((layer) => layer.title)).toEqual([
      "manifest.json",
      "ways.opl.gz.000",
      "ways.opl.gz.001",
      "ways.opl.gz.002",
      "pois.geojsonseq.gz",
      "region.poly",
      "basemap.pmtiles.000",
      "basemap.pmtiles.001",
      "basemap.pmtiles.002",
      "basemap.pmtiles.003",
      "basemap.pmtiles.004",
    ]);
    fake.publish(artefact);
    const build = await pull("monaco");
    expect(await readFile(join(build.dir, "ways.opl.gz"))).toEqual(
      await fixtureFile("ways.opl.gz"),
    );
    expect(await readFile(join(build.dir, "basemap.pmtiles"))).toEqual(
      await fixtureFile("basemap.pmtiles"),
    );
    expect((await readdir(build.dir)).some((name) => /\.\d{3}$/.test(name))).toBe(false);
  });

  it("refuses chunks that make another file than manifest.json says", async () => {
    // Every chunk is its own digest, but the file they make is not the one listed.
    const artefact = monaco({
      chunkBytes: 100_000,
      editTrail: (manifest) => ({
        ...manifest,
        files: (manifest["files"] as Record<string, unknown>[]).map((file) =>
          file["name"] === "basemap.pmtiles" ? { ...file, sha256: "0".repeat(64) } : file,
        ),
      }),
    });
    fake.publish(artefact);
    expect(await refusal(pull("monaco"))).toBe("digest");
    expect(await downloadsLeft()).toEqual([]);
    expect(await listLocalBuilds(root, "monaco")).toEqual([]);
  });

  it("downloads nothing for a build it holds already", async () => {
    fake.publish(monaco());
    const first = await pull("monaco");
    const before = fake.requests.length;
    const again = await pull("monaco");
    expect(again.dir).toBe(first.dir);
    expect(fake.requests.slice(before).filter((request) => request.server === "blobs")).toEqual([]);
  });

  it("keeps a rebuild of the same extract as a build of its own", async () => {
    const first = monaco();
    fake.publish(first);
    await pull("monaco");
    const rebuild = monaco({ builtAt: "2026-10-28T12:00:00Z" });
    expect(rebuild.digest).not.toBe(first.digest);
    fake.publish(rebuild);
    const second = await pull("monaco");
    expect(second.name).toBe(`20261027-${rebuild.digest.slice(7, 15)}`);
    expect((await listLocalBuilds(root, "monaco")).map((build) => build.digest)).toEqual([
      rebuild.digest,
      first.digest,
    ]);
  });
});

describe("refusing what is not right, keeping the build already there", () => {
  async function withOldBuild(): Promise<string> {
    fake.publish(monaco());
    return (await pull("monaco")).dir;
  }

  async function expectOldBuildOnly(oldDir: string): Promise<void> {
    expect(await downloadsLeft()).toEqual([]);
    expect((await listLocalBuilds(root, "monaco")).map((build) => build.dir)).toEqual([oldDir]);
    expect(await readFile(join(oldDir, "ways.opl.gz"))).toEqual(await fixtureFile("ways.opl.gz"));
  }

  it("refuses a blob whose bytes are not its digest", async () => {
    const oldDir = await withOldBuild();
    const next = monaco({ buildId: "20261028" });
    fake.publish(next);
    const ways = next.layers.find((layer) => layer.title === "ways.opl.gz");
    fake.blobFaults.set(ways?.digest ?? "", { kind: "corrupt" });
    expect(await refusal(pull("monaco"))).toBe("digest");
    await expectOldBuildOnly(oldDir);
  });

  it("resumes a download that broke off where it stopped", async () => {
    const artefact = monaco();
    fake.publish(artefact);
    const basemap = artefact.layers.find((layer) => layer.title === "basemap.pmtiles");
    fake.blobFaults.set(basemap?.digest ?? "", { kind: "truncate", after: 65_536, times: 1 });
    const build = await pull("monaco");
    expect(await readFile(join(build.dir, "basemap.pmtiles"))).toEqual(
      await fixtureFile("basemap.pmtiles"),
    );
    const requests = fake.requests.filter(
      (request) => request.server === "blobs" && request.path.includes(basemap?.digest ?? "-"),
    );
    // From what arrived before the cut: at most what was sent, some of which the cut may lose.
    const [first, resumed] = requests.map((request) => request.range);
    expect(first).toBeNull();
    const offset = Number(/^bytes=(\d+)-$/.exec(resumed ?? "")?.[1]);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual(65_536);
    expect(requests).toHaveLength(2);
  });

  it("starts over when the server ignores the range", async () => {
    const artefact = monaco();
    fake.publish(artefact);
    const digest = artefact.layers.find((layer) => layer.title === "basemap.pmtiles")?.digest ?? "";
    fake.blobFaults.set(digest, { kind: "truncate", after: 1000, times: 1 });
    const client = clientFor();
    let calls = 0;
    const build = await pull("monaco", {
      client,
      source: {
        openBlob: (requested, options) => {
          calls += requested === digest ? 1 : 0;
          // The resumed request is answered with the whole blob again.
          if (requested === digest && calls === 2) {
            fake.blobFaults.set(requested, { kind: "ignore-range", times: 1 });
          }
          return client.openBlob(requested, options);
        },
      },
    });
    expect(calls).toBe(2);
    expect(await readFile(join(build.dir, "basemap.pmtiles"))).toEqual(
      await fixtureFile("basemap.pmtiles"),
    );
  });

  it("gives up on a blob that keeps ending early", async () => {
    const oldDir = await withOldBuild();
    const next = monaco({ buildId: "20261028" });
    fake.publish(next);
    const basemap = next.layers.find((layer) => layer.title === "basemap.pmtiles");
    fake.blobFaults.set(basemap?.digest ?? "", { kind: "truncate", after: 1000 });
    expect(await refusal(pull("monaco"))).toBe("truncated");
    await expectOldBuildOnly(oldDir);
  });

  it("refuses a blob longer than its layer, while it reads", async () => {
    const oldDir = await withOldBuild();
    const next = monaco({ buildId: "20261028" });
    fake.publish(next);
    const poly = next.layers.find((layer) => layer.title === "region.poly");
    fake.blobFaults.set(poly?.digest ?? "", { kind: "overlong" });
    expect(await refusal(pull("monaco"))).toBe("too_large");
    await expectOldBuildOnly(oldDir);
  });

  it("refuses a build larger than MAP_DATA_MAX_GB before it downloads anything", async () => {
    fake.publish(monaco());
    expect(await refusal(pull("monaco", { maxBytes: 100_000 }))).toBe("too_large");
    expect(fake.requests.filter((request) => request.server === "blobs")).toEqual([]);
  });

  it("refuses a manifest whose layers claim more than the cap", async () => {
    fake.publish(
      monaco({
        editOci: (manifest) => ({
          ...manifest,
          layers: (manifest["layers"] as Record<string, unknown>[]).map((layer, index) =>
            index === 1 ? { ...layer, size: 4e15 } : layer,
          ),
        }),
      }),
    );
    expect(await refusal(pull("monaco"))).toBe("too_large");
    expect(fake.requests.filter((request) => request.server === "blobs")).toEqual([]);
  });

  it("refuses a manifest over 256 KB without reading it all", async () => {
    fake.publish(
      monaco({
        editOci: (manifest) => ({
          ...manifest,
          annotations: { ...(manifest["annotations"] as object), padding: "x".repeat(300_000) },
        }),
      }),
    );
    expect(await refusal(clientFor().resolve("monaco", never))).toBe("too_large");
  });

  it("refuses a build the volume has no room for", async () => {
    fake.publish(monaco());
    expect(await refusal(pull("monaco", { freeBytes: 1000 }))).toBe("too_large");
    expect(fake.requests.filter((request) => request.server === "blobs")).toEqual([]);
  });

  it("answers an unknown region with not_found", async () => {
    fake.publish(monaco());
    const error = await clientFor()
      .resolve("luxembourg", never)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({ reason: "not_found" });
    expect((error as Error).message).toContain(
      `${fake.host}/jenspenneman/trail-mapdata:luxembourg`,
    );
  });

  it("tries a busy registry again, and gives up after its attempts", async () => {
    fake.publish(monaco());
    fake.manifestStatuses.push(503, 502);
    const resolved = await clientFor().resolve("monaco", never);
    expect(resolved.tag).toBe("monaco");
    fake.manifestStatuses.push(503, 503, 503, 503);
    const error = await clientFor()
      .resolve("monaco", never)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ reason: "status", status: 503, retryable: true });
  });
});

describe("artefacts that are not what Trail publishes", () => {
  const layers = (manifest: Record<string, unknown>) =>
    manifest["layers"] as Record<string, unknown>[];
  const titled = (title: string) => ({ "org.opencontainers.image.title": title });
  const cases: [string, NonNullable<Parameters<typeof makeArtefact>[0]["editOci"]>][] = [
    [
      "another artifact type",
      (manifest) => ({ ...manifest, artifactType: "application/vnd.other" }),
    ],
    [
      "another region in the annotations",
      (manifest) => ({
        ...manifest,
        annotations: {
          ...(manifest["annotations"] as object),
          "com.jenspenneman.trail.mapdata.region": "belgium",
        },
      }),
    ],
    [
      "no build id",
      (manifest) => ({
        ...manifest,
        annotations: { "com.jenspenneman.trail.mapdata.region": "monaco" },
      }),
    ],
    [
      "a file name that leaves the directory",
      (manifest) => ({
        ...manifest,
        layers: layers(manifest).map((layer, index) =>
          index === 3 ? { ...layer, annotations: titled("../../../etc/region.poly") } : layer,
        ),
      }),
    ],
    [
      "a file Trail does not know",
      (manifest) => ({
        ...manifest,
        layers: [
          ...layers(manifest),
          { ...layers(manifest)[3], annotations: titled("styles.json") },
        ],
      }),
    ],
    [
      "a known file with another media type",
      (manifest) => ({
        ...manifest,
        layers: layers(manifest).map((layer, index) =>
          index === 1 ? { ...layer, mediaType: "application/octet-stream" } : layer,
        ),
      }),
    ],
    [
      "a file twice",
      (manifest) => ({ ...manifest, layers: [...layers(manifest), layers(manifest)[1]] }),
    ],
    [
      "no region.poly",
      (manifest) => ({ ...manifest, layers: layers(manifest).filter((_, index) => index !== 3) }),
    ],
  ];

  for (const [what, editOci] of cases) {
    it(`refuses ${what} before it downloads anything`, async () => {
      fake.publish(monaco({ editOci }));
      expect(await refusal(pull("monaco"))).toBe("malformed");
      expect(fake.requests.filter((request) => request.server === "blobs")).toEqual([]);
      expect(await readdir(root)).not.toContain("etc");
    });
  }

  it("refuses chunks with a gap", async () => {
    fake.publish(
      monaco({
        chunkBytes: 100_000,
        editOci: (manifest) => ({
          ...manifest,
          layers: layers(manifest).filter(
            (layer) =>
              (layer["annotations"] as Record<string, string>)["org.opencontainers.image.title"] !==
              "basemap.pmtiles.002",
          ),
        }),
      }),
    );
    expect(await refusal(pull("monaco"))).toBe("malformed");
  });

  it("refuses a manifest.json that describes another build or other files", async () => {
    fake.publish(monaco({ editTrail: (manifest) => ({ ...manifest, build: { id: "20261026" } }) }));
    expect(await refusal(pull("monaco"))).toBe("malformed");
    fake.publish(
      monaco({
        editTrail: (manifest) => ({
          ...manifest,
          files: (manifest["files"] as Record<string, unknown>[]).filter(
            (file) => file["name"] !== "pois.geojsonseq.gz",
          ),
        }),
      }),
    );
    expect(await refusal(pull("monaco"))).toBe("malformed");
    // Only manifest.json was fetched each time, and nothing is left behind.
    expect(await downloadsLeft()).toEqual([]);
    expect(await listLocalBuilds(root, "monaco")).toEqual([]);
  });
});

describe("credentials and the hosts it talks to", () => {
  function capture(): { logger: Logger; text: () => string } {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    return {
      logger: createLogger({ level: "trace", destination: stream }),
      text: () => lines.join(""),
    };
  }

  it("pulls a private package with MAP_DATA_REGISTRY_TOKEN, sent to the token service only", async () => {
    fake.credentials = { username: "jens", password: "ghp_s3cret-token" };
    fake.publish(monaco());
    const credentials = parseRegistryCredentials("jens:ghp_s3cret-token");
    const log = capture();
    await pull("monaco", { client: clientFor({ credentials, logger: log.logger }) });
    const basic = `Basic ${Buffer.from("jens:ghp_s3cret-token").toString("base64")}`;
    for (const request of fake.requests) {
      if (request.authorization === basic) expect(request.path.startsWith("/token?")).toBe(true);
      if (request.server === "blobs") expect(request.authorization).toBeNull();
    }
    expect(fake.requests.some((request) => request.authorization === basic)).toBe(true);
    const text = log.text();
    for (const secret of ["ghp_s3cret-token", basic.slice(6), ...fake.tokens, "sig="]) {
      expect(text).not.toContain(secret);
    }
  });

  it("is refused without the token, or with a wrong one", async () => {
    fake.credentials = { username: "jens", password: "ghp_s3cret-token" };
    fake.publish(monaco());
    const anonymous = await clientFor()
      .resolve("monaco", never)
      .catch((caught: unknown) => caught);
    expect(anonymous).toMatchObject({ reason: "denied" });
    expect((anonymous as Error).message).toContain("MAP_DATA_REGISTRY_TOKEN");
    const wrong = await clientFor({ credentials: parseRegistryCredentials("jens:ghp_n0t-1t") })
      .resolve("monaco", never)
      .catch((caught: unknown) => caught);
    expect(wrong).toMatchObject({ reason: "denied" });
    expect((wrong as Error).message).not.toContain("ghp_n0t-1t");
  });

  it("never prints the token", () => {
    const credentials = parseRegistryCredentials("jens:ghp_s3cret-token");
    expect(JSON.stringify({ credentials })).toBe('{"credentials":"[redacted]"}');
    expect(inspect(credentials)).not.toContain("ghp_s3cret-token");
    expect(String(credentials)).not.toContain("ghp_s3cret-token");
  });

  it("follows no redirect to a host other than the blob host", async () => {
    fake.publish(monaco());
    fake.blobRedirect = `http://${fake.elsewhereHost}`;
    expect(await refusal(pull("monaco"))).toBe("host");
    fake.blobRedirect = `https://${fake.blobHost}`;
    expect(await refusal(pull("monaco"))).toBe("host");
    expect(fake.requests.filter((request) => request.server === "elsewhere")).toEqual([]);
    expect(await downloadsLeft()).toEqual([]);
  });

  it("asks no token service on another host", async () => {
    fake.credentials = { username: "jens", password: "ghp_s3cret-token" };
    fake.publish(monaco());
    fake.realm = `http://${fake.elsewhereHost}/token`;
    const client = clientFor({ credentials: parseRegistryCredentials("jens:ghp_s3cret-token") });
    expect(await refusal(client.resolve("monaco", never))).toBe("host");
    expect(fake.requests.filter((request) => request.server === "elsewhere")).toEqual([]);
  });

  it("ignores proxy variables", async () => {
    fake.publish(monaco());
    const saved = { ...process.env };
    const proxy = `http://${fake.elsewhereHost}`;
    Object.assign(process.env, {
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      ALL_PROXY: proxy,
      http_proxy: proxy,
    });
    try {
      await pull("monaco");
    } finally {
      for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy"]) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
    expect(fake.requests.filter((request) => request.server === "elsewhere")).toEqual([]);
  });
});
