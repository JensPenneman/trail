import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  artefactFiles,
  artefactType,
  buildAnnotation,
  regionAnnotation,
} from "../../src/mapdata/artefactLayout";
import { ociManifestMediaType } from "../../src/mapdata/registry";

/** The Monaco artefact of task 0, committed as the workflow built it. */
export const monacoFixture = new URL("../fixtures/mapdata/monaco/", import.meta.url).pathname;

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A file of an artefact, by name, as build.sh writes it. */
export interface ArtefactFile {
  name: keyof typeof artefactFiles;
  bytes: Buffer;
}

/** The fixture's files (manifest.json aside, which `makeArtefact` writes as build.sh would). */
export function monacoFiles(): ArtefactFile[] {
  return (["ways.opl.gz", "pois.geojsonseq.gz", "region.poly", "basemap.pmtiles"] as const).map(
    (name) => ({ name, bytes: readFileSync(join(monacoFixture, name)) }),
  );
}

/** An artefact as publish.sh pushes it: blobs by digest and the manifest's exact bytes. */
export interface FakeArtefact {
  region: string;
  buildId: string;
  digest: string;
  manifest: Buffer;
  trailManifest: Buffer;
  blobs: Map<string, Buffer>;
  /** Each layer's title and digest, in the manifest's order. */
  layers: { title: string; digest: string; size: number }[];
}

type Json = Record<string, unknown>;

/**
 * Builds an artefact the way build.sh and publish.sh do: manifest.json with
 * every file's size and SHA-256 (and its chunks when it is larger than
 * `chunkBytes`), one layer per file or chunk, titled with its name, the
 * region and the build in the manifest's annotations. `editTrail` and
 * `editOci` change the two manifests before they are written, for refusals.
 */
export function makeArtefact(options: {
  region: string;
  buildId: string;
  files: ArtefactFile[];
  chunkBytes?: number;
  builtAt?: string;
  editTrail?: (manifest: Json) => Json;
  editOci?: (manifest: Json) => Json;
}): FakeArtefact {
  const chunkBytes = options.chunkBytes ?? Number.POSITIVE_INFINITY;
  const blobs = new Map<string, Buffer>();
  const layers: { title: string; mediaType: string; bytes: Buffer }[] = [];
  const files = options.files.map((file) => {
    const mediaType = artefactFiles[file.name];
    const entry: Json = {
      name: file.name,
      mediaType,
      bytes: file.bytes.length,
      sha256: sha256(file.bytes),
    };
    if (file.bytes.length > chunkBytes) {
      const chunks: Json[] = [];
      for (
        let offset = 0, index = 0;
        offset < file.bytes.length;
        offset += chunkBytes, index += 1
      ) {
        const piece = file.bytes.subarray(offset, offset + chunkBytes);
        const title = `${file.name}.${String(index).padStart(3, "0")}`;
        chunks.push({ name: title, bytes: piece.length, sha256: sha256(piece) });
        layers.push({ title, mediaType, bytes: piece });
      }
      entry["chunks"] = chunks;
    } else {
      layers.push({ title: file.name, mediaType, bytes: file.bytes });
    }
    return entry;
  });
  const day = options.buildId;
  const trail: Json = {
    mediaType: artefactFiles["manifest.json"],
    region: options.region,
    extract: {
      geofabrik: `europe/${options.region}`,
      url: `https://download.geofabrik.de/europe/${options.region}-${day.slice(2)}.osm.pbf`,
      mirror: null,
      timestamp: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T21:23:59Z`,
    },
    build: {
      id: day,
      at: options.builtAt ?? "2026-10-28T10:36:15Z",
      commit: "0".repeat(40),
      tools: {},
    },
    files,
  };
  const trailBytes = Buffer.from(JSON.stringify(options.editTrail?.(trail) ?? trail, null, 2));
  layers.unshift({
    title: "manifest.json",
    mediaType: artefactFiles["manifest.json"],
    bytes: trailBytes,
  });
  const descriptors = layers.map((layer) => {
    const digest = `sha256:${sha256(layer.bytes)}`;
    blobs.set(digest, layer.bytes);
    return {
      mediaType: layer.mediaType,
      digest,
      size: layer.bytes.length,
      annotations: { "org.opencontainers.image.title": layer.title },
    };
  });
  const oci: Json = {
    schemaVersion: 2,
    mediaType: ociManifestMediaType,
    artifactType: artefactType,
    config: {
      mediaType: "application/vnd.oci.empty.v1+json",
      digest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      size: 2,
      data: "e30=",
    },
    layers: descriptors,
    annotations: {
      [regionAnnotation]: options.region,
      [buildAnnotation]: options.buildId,
      "org.opencontainers.image.created": options.builtAt ?? "2026-10-28T10:36:15Z",
    },
  };
  const manifest = Buffer.from(JSON.stringify(options.editOci?.(oci) ?? oci));
  return {
    region: options.region,
    buildId: options.buildId,
    digest: `sha256:${sha256(manifest)}`,
    manifest,
    trailManifest: trailBytes,
    blobs,
    layers: descriptors.map((layer) => ({
      title: layer.annotations["org.opencontainers.image.title"],
      digest: layer.digest,
      size: layer.size,
    })),
  };
}

/** A request either server received, with what matters for the checks. */
export interface RecordedRequest {
  server: "registry" | "blobs" | "elsewhere";
  method: string;
  path: string;
  authorization: string | null;
  range: string | null;
}

/** Ways a blob request goes wrong, for `times` requests (default: every one). */
export interface BlobFault {
  kind: "corrupt" | "truncate" | "stall" | "overlong" | "ignore-range" | "status";
  /** truncate, stall: the bytes sent before the connection is cut, or goes quiet. */
  after?: number;
  status?: number;
  times?: number;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * GHCR in a test: a token service (anonymous, or Basic credentials for a
 * private repository), manifests by tag and by digest, blobs answered with a
 * 307 to a second server — the blob host — with a signature in the query,
 * which serves them with Range support. Faults, statuses and the challenge's
 * realm can be changed per test; every request is recorded.
 */
export class FakeRegistry {
  readonly repository: string;
  host = "";
  blobHost = "";
  /** A third server, which must never be reached: where a bad redirect or realm points. */
  elsewhereHost = "";
  readonly requests: RecordedRequest[] = [];
  readonly tokens: string[] = [];
  readonly tags = new Map<string, FakeArtefact>();
  readonly blobFaults = new Map<string, BlobFault>();
  /** The next answers to manifest requests (status codes), before the real one. */
  readonly manifestStatuses: number[] = [];
  credentials: { username: string; password: string } | null = null;
  /** Where the challenge's realm points (default: this registry's /token). */
  realm: string | null = null;
  /** Where blobs are redirected (default: the blob host); `direct` serves them from the registry. */
  blobRedirect: string | "direct" | null = null;
  readonly #servers: Server[] = [];

  constructor(repository = "jenspenneman/trail-mapdata") {
    this.repository = repository;
  }

  async start(): Promise<this> {
    const registry = createServer((request, response) => this.#registry(request, response));
    const blobs = createServer((request, response) => this.#blobs(request, response));
    const elsewhere = createServer((request, response) => {
      this.#record("elsewhere", request);
      response.writeHead(200, { "content-type": "application/json" }).end('{"token":"stolen"}');
    });
    this.#servers.push(registry, blobs, elsewhere);
    this.host = await listen(registry);
    this.blobHost = await listen(blobs);
    this.elsewhereHost = await listen(elsewhere);
    return this;
  }

  async close(): Promise<void> {
    await Promise.all(
      this.#servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  }

  /** Publishes an artefact under `tag` (by default `<region>`). */
  publish(artefact: FakeArtefact, tag = artefact.region): void {
    this.tags.set(tag, artefact);
  }

  #record(server: RecordedRequest["server"], request: IncomingMessage): void {
    this.requests.push({
      server,
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization ?? null,
      range: request.headers.range ?? null,
    });
  }

  #challenge(response: ServerResponse): void {
    const realm = this.realm ?? `http://${this.host}/token`;
    response
      .writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": `Bearer realm="${realm}",service="${this.host}",scope="repository:${this.repository}:pull"`,
      })
      .end('{"errors":[{"code":"UNAUTHORIZED"}]}');
  }

  #authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? "";
    return this.tokens.some((token) => header === `Bearer ${token}`);
  }

  #registry(request: IncomingMessage, response: ServerResponse): void {
    this.#record("registry", request);
    const url = new URL(request.url ?? "/", `http://${this.host}`);
    if (url.pathname === "/token") {
      const scope = url.searchParams.get("scope");
      const basic = request.headers.authorization ?? "";
      const expected =
        this.credentials === null
          ? null
          : `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString("base64")}`;
      if (
        scope !== `repository:${this.repository}:pull` ||
        (expected !== null && basic !== expected)
      ) {
        response
          .writeHead(403, { "content-type": "application/json" })
          .end('{"errors":[{"code":"DENIED"}]}');
        return;
      }
      const token = randomBytes(18).toString("base64url");
      this.tokens.push(token);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ token }));
      return;
    }
    const prefix = `/v2/${this.repository}/`;
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    if (!this.#authorized(request)) {
      this.#challenge(response);
      return;
    }
    const [kind, reference] = url.pathname.slice(prefix.length).split("/");
    if (kind === "manifests" && reference !== undefined) {
      const status = this.manifestStatuses.shift();
      if (status !== undefined) {
        response.writeHead(status, { "content-type": "application/json" }).end("{}");
        return;
      }
      const artefact =
        this.tags.get(reference) ??
        [...this.tags.values()].find((candidate) => candidate.digest === reference);
      if (artefact === undefined) {
        response
          .writeHead(404, { "content-type": "application/json" })
          .end('{"errors":[{"code":"MANIFEST_UNKNOWN","message":"manifest unknown"}]}');
        return;
      }
      response
        .writeHead(200, {
          "content-type": ociManifestMediaType,
          "content-length": artefact.manifest.length,
          "docker-content-digest": artefact.digest,
        })
        .end(artefact.manifest);
      return;
    }
    if (kind === "blobs" && reference !== undefined) {
      if (this.blobRedirect === "direct") {
        this.#serveBlob(reference, request, response);
        return;
      }
      const base = this.blobRedirect ?? `http://${this.blobHost}`;
      response
        .writeHead(307, {
          location: `${base}/blobs/${reference}?sig=${randomBytes(12).toString("hex")}&se=2099-01-01`,
          "content-length": 0,
        })
        .end();
      return;
    }
    response.writeHead(404).end();
  }

  #blobs(request: IncomingMessage, response: ServerResponse): void {
    this.#record("blobs", request);
    const url = new URL(request.url ?? "/", `http://${this.blobHost}`);
    const match = /^\/blobs\/(sha256:[0-9a-f]{64})$/.exec(url.pathname);
    if (match?.[1] === undefined || !url.searchParams.has("sig")) {
      response.writeHead(403).end();
      return;
    }
    this.#serveBlob(match[1], request, response);
  }

  #serveBlob(digest: string, request: IncomingMessage, response: ServerResponse): void {
    const blob = [...this.tags.values()]
      .map((artefact) => artefact.blobs.get(digest))
      .find(Boolean);
    if (blob === undefined) {
      response.writeHead(404).end();
      return;
    }
    let fault = this.blobFaults.get(digest);
    if (fault !== undefined) {
      if (fault.times !== undefined) {
        fault.times -= 1;
        if (fault.times <= 0) this.blobFaults.delete(digest);
      }
    } else {
      fault = undefined;
    }
    if (fault?.kind === "status") {
      response.writeHead(fault.status ?? 503).end();
      return;
    }
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? "");
    const start = range?.[1] !== undefined && fault?.kind !== "ignore-range" ? Number(range[1]) : 0;
    let body = blob.subarray(start);
    if (fault?.kind === "corrupt") {
      body = Buffer.from(body);
      body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 0xff;
    }
    if (fault?.kind === "overlong") {
      // No length announced: the client has to notice while it reads.
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(Buffer.concat([blob, Buffer.from("and some more")]));
      return;
    }
    const headers: Record<string, string | number> = {
      "content-type": "application/octet-stream",
      "content-length": body.length,
      "accept-ranges": "bytes",
    };
    if (start > 0) headers["content-range"] = `bytes ${start}-${blob.length - 1}/${blob.length}`;
    response.writeHead(start > 0 ? 206 : 200, headers);
    if (fault?.kind === "truncate") {
      response.write(body.subarray(0, fault.after ?? Math.floor(body.length / 2)), () => {
        response.socket?.destroy();
      });
      return;
    }
    if (fault?.kind === "stall") {
      // The rest never comes: the connection stays open until the client gives up.
      response.write(body.subarray(0, fault.after ?? 1));
      return;
    }
    response.end(body);
  }
}
