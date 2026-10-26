import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";
import { overpassQuery } from "./overpassQuery";
import { parseOverpassResponse } from "./parseOverpassResponse";
import { type TileAddress, type TileData, TileFetchError, type WaySource } from "./waySource";

export interface OverpassOptions {
  url: string;
  /** `Trail/<version> (+<PUBLIC_URL>)`: who is asking, as Overpass's usage policy wants. */
  userAgent: string;
  logger: Logger;
  /** At most one request this often (the public instances ask for restraint). */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Larger answers are cut off and refused. */
  maxBytes?: number;
  /** Attempts per tile for answers worth repeating (429, 5xx, network errors). */
  attempts?: number;
  /** For tests: the HTTP client and the clock. */
  fetch?: typeof fetch;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  sleep(ms, undefined, { signal }).then(() => undefined);

/** Reads a body up to `maxBytes`, refusing anything larger without reading it all. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number }> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new TileFetchError(`Overpass answer of ${declared} bytes is over the limit`);
  }
  const reader = response.body?.getReader();
  if (reader === undefined) return { text: "", bytes: 0 };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new TileFetchError(`Overpass answer over ${maxBytes} bytes`, { bytes });
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}

/**
 * Map data from an Overpass API instance (docs/architecture.md §17.3), one
 * query per z14 tile, politely: one request at a time and at most one every
 * two seconds, a 60-second timeout, a descriptive User-Agent, retries with
 * backoff for answers worth retrying (honouring Retry-After), a 20 MB cap on
 * the answer and strict parsing. The daily byte budget is the tile fetcher's.
 */
export class OverpassWaySource implements WaySource {
  readonly name = "overpass";
  readonly #options: Required<Omit<OverpassOptions, "logger">> & { logger: Logger };
  #lastRequestAt = Number.NEGATIVE_INFINITY;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: OverpassOptions) {
    this.#options = {
      minIntervalMs: 2000,
      timeoutMs: 60_000,
      maxBytes: 20_000_000,
      attempts: 3,
      fetch: globalThis.fetch.bind(globalThis),
      wait,
      now: () => Date.now(),
      ...options,
    };
  }

  /** One tile; requests from concurrent callers queue up behind each other. */
  fetchTile(tile: TileAddress, signal: AbortSignal): Promise<TileData> {
    const result = this.#queue.then(() => this.#fetchWithRetries(tile, signal));
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #fetchWithRetries(tile: TileAddress, signal: AbortSignal): Promise<TileData> {
    const { attempts, logger } = this.#options;
    let bytes = 0;
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this.#attempt(tile, signal);
      if (outcome.ok) return { ...outcome.data, bytes: outcome.data.bytes + bytes };
      bytes += outcome.bytes;
      if (!outcome.retryable || attempt >= attempts || signal.aborted) {
        throw new TileFetchError(outcome.message, { bytes });
      }
      const backoff = outcome.retryAfterMs ?? 5000 * 4 ** (attempt - 1);
      logger.warn(
        { tile, attempt, backoffMs: backoff, reason: outcome.message },
        "map tile fetch failed, retrying",
      );
      await this.#options.wait(backoff, signal);
    }
  }

  async #attempt(
    tile: TileAddress,
    signal: AbortSignal,
  ): Promise<
    | { ok: true; data: TileData }
    | { ok: false; retryable: boolean; message: string; bytes: number; retryAfterMs?: number }
  > {
    const { minIntervalMs, now } = this.#options;
    const pause = this.#lastRequestAt + minIntervalMs - now();
    if (pause > 0) await this.#options.wait(pause, signal);
    this.#lastRequestAt = now();
    let response: Response;
    try {
      response = await this.#options.fetch(this.#options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": this.#options.userAgent,
        },
        body: new URLSearchParams({ data: overpassQuery(tile) }).toString(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.#options.timeoutMs)]),
        redirect: "error",
      });
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        ok: false,
        retryable: true,
        message: `Overpass unreachable: ${String(error)}`,
        bytes: 0,
      };
    }
    if (!response.ok) {
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get("retry-after") ?? Number.NaN);
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        retryable,
        message: `Overpass answered ${response.status}`,
        bytes: 0,
        ...(Number.isFinite(retryAfter) && retryAfter >= 0
          ? { retryAfterMs: Math.min(300_000, retryAfter * 1000) }
          : {}),
      };
    }
    try {
      const { text, bytes } = await readCapped(response, this.#options.maxBytes);
      return { ok: true, data: parseOverpassResponse(text, bytes) };
    } catch (error) {
      if (signal.aborted) throw error;
      const bytes = error instanceof TileFetchError ? error.bytes : 0;
      // A timeout while reading is worth another try; a malformed answer is not.
      const retryable = error instanceof Error && error.name === "TimeoutError";
      return {
        ok: false,
        retryable,
        message: error instanceof Error ? error.message : String(error),
        bytes,
      };
    }
  }
}
