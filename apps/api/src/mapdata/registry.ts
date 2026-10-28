import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";
import type { RegistryCredentials } from "./registryCredentials";
import { isRetryableStatus, RegistryError } from "./registryError";
import { type RegistryReference, registryHosts } from "./registryReference";

/** The OCI image manifest, as `oras push` writes one for an artefact. */
export const ociManifestMediaType = "application/vnd.oci.image.manifest.v1+json";

/** A tag as the OCI distribution spec allows it. */
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** Blobs are addressed by SHA-256 only. */
const digestPattern = /^sha256:[0-9a-f]{64}$/;

/** A manifest of this size holds hundreds of layers; Trail's have a handful. */
const maxManifestBytes = 256 * 1024;
/** A token answer is a few KB of JSON. */
const maxTokenAnswerBytes = 64 * 1024;
const maxTokenLength = 16 * 1024;
/** A `WWW-Authenticate` header longer than this is not one Trail reads. */
const maxChallengeLength = 4096;

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  sleep(ms, undefined, { signal }).then(() => undefined);

export interface RegistryClientOptions {
  reference: RegistryReference;
  credentials: RegistryCredentials | null;
  logger: Logger;
  /** Until an answer's headers arrive. */
  headersTimeoutMs?: number;
  /** Attempts for a manifest when the registry is busy or away (blobs: the downloader's). */
  attempts?: number;
  /** For tests: plain HTTP to a fake registry on loopback, the hosts it redirects blobs to, the HTTP client and the clock. */
  scheme?: "https" | "http";
  blobHosts?: readonly string[];
  fetch?: typeof fetch;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** A manifest as the registry sent it, with the digest of its bytes. */
export interface ResolvedManifest {
  tag: string;
  /** `sha256:<hex>` of `bytes`: what identifies the build (docs/design/self-hosted-maps.md §4.3). */
  digest: string;
  /** Exactly what the registry sent, kept on the volume as `oci-manifest.json`. */
  bytes: Buffer;
  /** Parsed JSON, checked by `readArtefactLayout`. */
  json: unknown;
}

interface Challenge {
  scheme: string;
  params: Map<string, string>;
}

/** `Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="…"` → scheme and parameters. */
export function parseChallenge(header: string | null): Challenge | null {
  if (header === null || header.length > maxChallengeLength) return null;
  const match = /^\s*([A-Za-z]+)\s*(.*)$/s.exec(header);
  if (match === null) return null;
  const params = new Map<string, string>();
  const rest = match[2] ?? "";
  const param = /\s*([A-Za-z_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,"]*))\s*(?:,|$)/gy;
  let position = 0;
  while (position < rest.length) {
    param.lastIndex = position;
    const found = param.exec(rest);
    if (found === null || found[0].length === 0) return null;
    const value = found[2] === undefined ? (found[3] ?? "") : found[2].replace(/\\(.)/g, "$1");
    params.set((found[1] ?? "").toLowerCase(), value);
    position = param.lastIndex;
  }
  return { scheme: (match[1] ?? "").toLowerCase(), params };
}

/**
 * What failed, as a code (`ECONNREFUSED`, `UND_ERR_SOCKET`, `TimeoutError`):
 * an error's message or cause could quote the URL, and a blob URL carries a
 * signature.
 */
function errorCode(error: unknown): string {
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
    current = current.cause;
  }
  return error instanceof Error ? error.name : "unknown";
}

/** A URL for messages and logs: no query, which may carry a signature (GHCR's blob redirects do). */
const shown = (url: URL): string => `${url.origin}${url.pathname}`;

/** Reads a body up to `max` bytes, refusing a larger one without reading it all. */
async function readCapped(response: Response, max: number, what: string): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (declared > max) {
    await response.body?.cancel();
    throw new RegistryError(`${what} of ${declared} bytes is over the limit of ${max}`, {
      reason: "too_large",
    });
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (response.body === null) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > max) {
      await response.body.cancel().catch(() => undefined);
      throw new RegistryError(`${what} is over the limit of ${max} bytes`, { reason: "too_large" });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * The registry client of the map data (docs/design/self-hosted-maps.md §4.3):
 * `fetch` only, HTTPS only, and only to the registry's own host (its API and
 * its token service) and the one host its blob downloads redirect to
 * (`registryHosts`). A manifest is asked for by tag and identified by the
 * SHA-256 of its bytes; blobs by digest. Anonymous for a public package (a
 * token from the registry's token service without credentials); with
 * `MAP_DATA_REGISTRY_TOKEN`, Basic credentials for the token service only.
 * Credentials and tokens never go to the blob host, into a message or a log
 * line. Proxy variables are ignored: Node's `fetch` honours them only when
 * `NODE_USE_ENV_PROXY` is set, which is the operator's explicit choice.
 */
export class RegistryClient {
  readonly reference: RegistryReference;
  readonly #credentials: RegistryCredentials | null;
  readonly #logger: Logger;
  readonly #scheme: "https" | "http";
  readonly #apiHost: string;
  readonly #blobHosts: ReadonlySet<string>;
  readonly #fetch: typeof fetch;
  readonly #wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #headersTimeoutMs: number;
  readonly #attempts: number;
  /** `Bearer <token>` from the token service, or `Basic …` for a registry that asks for it. */
  #authorization: string | null = null;

  constructor(options: RegistryClientOptions) {
    this.reference = options.reference;
    this.#credentials = options.credentials;
    this.#logger = options.logger;
    this.#scheme = options.scheme ?? "https";
    const hosts = registryHosts(options.reference);
    this.#apiHost = hosts.api;
    this.#blobHosts = new Set(options.blobHosts ?? hosts.blobs);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#wait = options.wait ?? wait;
    this.#headersTimeoutMs = options.headersTimeoutMs ?? 30_000;
    this.#attempts = options.attempts ?? 4;
  }

  /** `ghcr.io/jenspenneman/trail-mapdata:belgium`, for messages. */
  describe(tag: string): string {
    return `${this.reference.host}/${this.reference.repository}:${tag}`;
  }

  /**
   * The manifest `tag` points at. Busy answers (429, 5xx) and network errors
   * are tried again with backoff; a missing tag, a refusal or anything
   * malformed is not.
   */
  async resolve(tag: string, signal: AbortSignal): Promise<ResolvedManifest> {
    if (!tagPattern.test(tag)) {
      throw new RegistryError(`"${tag}" is not a tag`, { reason: "malformed" });
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#resolveOnce(tag, signal);
      } catch (error) {
        if (!(error instanceof RegistryError) || !error.retryable || attempt >= this.#attempts) {
          throw error;
        }
        if (signal.aborted) throw error;
        const backoff = Math.min(60_000, 2000 * 4 ** (attempt - 1));
        this.#logger.warn(
          { attempt, backoffMs: backoff, reason: error.reason, status: error.status },
          "map data registry did not answer, retrying",
        );
        await this.#wait(backoff, signal);
      }
    }
  }

  async #resolveOnce(tag: string, signal: AbortSignal): Promise<ResolvedManifest> {
    const response = await this.#registryRequest(
      `manifests/${tag}`,
      { accept: ociManifestMediaType },
      signal,
    );
    if (response.status === 404) {
      await response.body?.cancel();
      throw new RegistryError(`${this.describe(tag)} does not exist`, { reason: "not_found" });
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw this.#statusError(response.status, `the manifest of ${this.describe(tag)}`);
    }
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (type !== ociManifestMediaType) {
      await response.body?.cancel();
      throw new RegistryError(
        `${this.describe(tag)} is not an OCI artefact manifest (${type || "no content type"})`,
        { reason: "malformed" },
      );
    }
    const bytes = await readCapped(response, maxManifestBytes, "the manifest");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const announced = response.headers.get("docker-content-digest");
    if (announced !== null && announced.trim() !== digest) {
      throw new RegistryError(
        `the manifest of ${this.describe(tag)} has the digest ${digest}, not the ${announced.trim()} the registry announced`,
        { reason: "digest" },
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new RegistryError(`the manifest of ${this.describe(tag)} is not JSON`, {
        reason: "malformed",
      });
    }
    return { tag, digest, bytes, json };
  }

  /**
   * One request for a blob from `offset` on (a Range request after the
   * first), following the one redirect GHCR answers with to its blob host,
   * without the registry's authorization. The caller reads the body,
   * checks the status (200 or 206) and the digest, and tries again.
   */
  async openBlob(
    digest: string,
    options: { signal: AbortSignal; offset: number },
  ): Promise<Response> {
    if (!digestPattern.test(digest)) {
      throw new RegistryError(`"${digest}" is not a SHA-256 digest`, { reason: "malformed" });
    }
    const range = options.offset > 0 ? `bytes=${options.offset}-` : null;
    let response = await this.#registryRequest(`blobs/${digest}`, { range }, options.signal);
    if (isRedirect(response.status)) {
      const target = this.#redirectTarget(response);
      await response.body?.cancel();
      response = await this.#send(
        target,
        { headers: blobHeaders(range), purpose: "blob" },
        options.signal,
      );
      if (isRedirect(response.status)) {
        await response.body?.cancel();
        throw new RegistryError(`the blob host redirected ${digest} once more`, {
          reason: "host",
        });
      }
    }
    if (response.status === 200 || response.status === 206) return response;
    await response.body?.cancel();
    if (response.status === 404) {
      throw new RegistryError(`the registry has no blob ${digest}`, { reason: "not_found" });
    }
    throw this.#statusError(response.status, `blob ${digest}`);
  }

  #redirectTarget(response: Response): URL {
    const location = response.headers.get("location");
    const target = location === null ? null : URL.parse(location, this.#apiUrl("blobs/").href);
    if (target === null) {
      throw new RegistryError("the registry redirected a blob without a usable location", {
        reason: "malformed",
      });
    }
    if (target.protocol !== `${this.#scheme}:` || !this.#blobHosts.has(target.host)) {
      throw new RegistryError(
        `the registry redirected a blob to ${target.protocol}//${target.host}, which is not a blob host of ${this.#apiHost}`,
        { reason: "host" },
      );
    }
    return target;
  }

  #apiUrl(path: string): URL {
    return new URL(`${this.#scheme}://${this.#apiHost}/v2/${this.reference.repository}/${path}`);
  }

  /** A request to the registry's API, authenticated as its challenge asks (once per client, again when a token expires). */
  async #registryRequest(
    path: string,
    options: { accept?: string; range?: string | null },
    signal: AbortSignal,
  ): Promise<Response> {
    const url = this.#apiUrl(path);
    const headers = (): Headers => {
      const result =
        options.accept === undefined
          ? blobHeaders(options.range ?? null)
          : new Headers({ accept: options.accept });
      if (this.#authorization !== null) result.set("authorization", this.#authorization);
      return result;
    };
    let response = await this.#send(url, { headers: headers(), purpose: "api" }, signal);
    if (response.status !== 401) return response;
    const challenge = parseChallenge(response.headers.get("www-authenticate"));
    await response.body?.cancel();
    await this.#authenticate(challenge, signal);
    response = await this.#send(url, { headers: headers(), purpose: "api" }, signal);
    if (response.status === 401) {
      await response.body?.cancel();
      throw this.#denied();
    }
    return response;
  }

  async #authenticate(challenge: Challenge | null, signal: AbortSignal): Promise<void> {
    if (challenge?.scheme === "basic") {
      if (this.#credentials === null) throw this.#denied();
      this.#authorization = this.#credentials.basicAuthorization();
      return;
    }
    const realm = challenge?.scheme === "bearer" ? challenge.params.get("realm") : undefined;
    const tokenUrl = realm === undefined ? null : URL.parse(realm);
    if (tokenUrl === null) {
      throw new RegistryError("the registry asked for an authentication Trail does not speak", {
        reason: "malformed",
      });
    }
    if (tokenUrl.protocol !== `${this.#scheme}:` || tokenUrl.host !== this.#apiHost) {
      throw new RegistryError(
        `the registry's token service is on ${tokenUrl.protocol}//${tokenUrl.host}, not on ${this.#apiHost}: Trail sends no request there`,
        { reason: "host" },
      );
    }
    const service = challenge?.params.get("service");
    if (service !== undefined) tokenUrl.searchParams.set("service", service);
    // Pull access to this repository only, whatever the challenge names.
    tokenUrl.searchParams.set("scope", `repository:${this.reference.repository}:pull`);
    const headers = new Headers({ accept: "application/json" });
    if (this.#credentials !== null) {
      headers.set("authorization", this.#credentials.basicAuthorization());
    }
    const response = await this.#send(tokenUrl, { headers, purpose: "api" }, signal);
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw this.#denied();
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw this.#statusError(response.status, "the registry's token service");
    }
    const body = await readCapped(response, maxTokenAnswerBytes, "the token answer");
    let token: unknown;
    try {
      const parsed = JSON.parse(body.toString("utf8")) as {
        token?: unknown;
        access_token?: unknown;
      };
      token = parsed.token ?? parsed.access_token;
    } catch {
      token = undefined;
    }
    if (typeof token !== "string" || token.length === 0 || token.length > maxTokenLength) {
      throw new RegistryError("the registry's token service answered without a token", {
        reason: "malformed",
      });
    }
    if (!/^[\x21-\x7e]+$/.test(token)) {
      throw new RegistryError("the registry's token service answered with an unusable token", {
        reason: "malformed",
      });
    }
    this.#authorization = `Bearer ${token}`;
  }

  #denied(): RegistryError {
    this.#authorization = null;
    const what = `${this.reference.host}/${this.reference.repository}`;
    return new RegistryError(
      this.#credentials === null
        ? `the registry refused an anonymous pull of ${what}: the package does not exist, or it is private and needs MAP_DATA_REGISTRY_TOKEN`
        : `the registry refused MAP_DATA_REGISTRY_TOKEN for ${what}: the token is wrong, expired, or may not read the package`,
      { reason: "denied" },
    );
  }

  #statusError(status: number, what: string): RegistryError {
    return new RegistryError(`the registry answered ${status} for ${what}`, {
      reason: "status",
      status,
      retryable: isRetryableStatus(status),
    });
  }

  /**
   * One HTTP request to an allowed host, without following redirects, with a
   * timeout until the headers arrive. The body may take as long as it takes:
   * the downloader cuts it off when no data comes (`signal`).
   */
  async #send(
    url: URL,
    init: { headers: Headers; purpose: "api" | "blob" },
    signal: AbortSignal,
  ): Promise<Response> {
    const allowed =
      init.purpose === "api" ? url.host === this.#apiHost : this.#blobHosts.has(url.host);
    if (url.protocol !== `${this.#scheme}:` || !allowed) {
      throw new RegistryError(`Trail does not send requests to ${url.protocol}//${url.host}`, {
        reason: "host",
      });
    }
    const headersTimeout = new AbortController();
    const timer = setTimeout(() => headersTimeout.abort(), this.#headersTimeoutMs);
    try {
      return await this.#fetch(url, {
        headers: init.headers,
        redirect: "manual",
        signal: AbortSignal.any([signal, headersTimeout.signal]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      const timedOut = headersTimeout.signal.aborted;
      this.#logger.debug(
        { url: shown(url), code: errorCode(error), timedOut },
        "map data registry request failed",
      );
      throw new RegistryError(
        timedOut
          ? `${url.host} did not answer within ${Math.round(this.#headersTimeoutMs / 1000)} s`
          : `${url.host} could not be reached`,
        { reason: timedOut ? "timeout" : "unreachable", retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

const isRedirect = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

/** Blobs come as they are: no compression a client would undo before the digest is checked. */
function blobHeaders(range: string | null): Headers {
  const headers = new Headers({ "accept-encoding": "identity" });
  if (range !== null) headers.set("range", range);
  return headers;
}
