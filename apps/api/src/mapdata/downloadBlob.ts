import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";
import type { Layer } from "./artefactLayout";
import { RegistryError } from "./registryError";

/** Where blobs come from: the registry client, or a stand-in in tests. */
export interface BlobSource {
  openBlob(digest: string, options: { signal: AbortSignal; offset: number }): Promise<Response>;
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  sleep(ms, undefined, { signal }).then(() => undefined);

/** `bytes 100-199/200` → its three numbers (the total may be `*`). */
function parseContentRange(
  header: string | null,
): { start: number; end: number; total: number | null } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header?.trim() ?? "");
  if (match === null) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3]),
  };
}

/**
 * Downloads one blob into `file` at `position` (a chunk lands after the ones
 * before it) while a SHA-256 runs over it, and refuses it unless it has
 * exactly the layer's size and digest. A download that breaks off, ends
 * early or stalls for `idleTimeoutMs` is resumed where it stopped with a
 * Range request (from the start when the server ignores the range), at most
 * `attempts` times; too many bytes or the wrong digest end it at once.
 */
export async function downloadBlob(input: {
  source: BlobSource;
  layer: Layer;
  file: FileHandle;
  position: number;
  signal: AbortSignal;
  logger: Logger;
  attempts?: number;
  idleTimeoutMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const { source, layer, file, position, signal, logger } = input;
  const attempts = input.attempts ?? 5;
  const idleTimeoutMs = input.idleTimeoutMs ?? 60_000;
  const pause = input.wait ?? wait;
  let hash = createHash("sha256");
  let written = 0;
  for (let attempt = 1; ; attempt += 1) {
    const idle = new AbortController();
    let timer = setTimeout(() => idle.abort(), idleTimeoutMs);
    const restartTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(), idleTimeoutMs);
    };
    try {
      const response = await source.openBlob(layer.digest, {
        signal: AbortSignal.any([signal, idle.signal]),
        offset: written,
      });
      if (response.status === 206) {
        const range = parseContentRange(response.headers.get("content-range"));
        if (
          range === null ||
          range.start !== written ||
          range.end !== layer.size - 1 ||
          (range.total !== null && range.total !== layer.size)
        ) {
          await response.body?.cancel();
          throw new RegistryError(`the registry resumed ${layer.digest} at the wrong place`, {
            reason: "malformed",
          });
        }
      } else if (written > 0) {
        // The whole blob again: start over.
        await file.truncate(position);
        written = 0;
        hash = createHash("sha256");
      }
      const declared = Number(response.headers.get("content-length") ?? Number.NaN);
      if (Number.isFinite(declared) && declared !== layer.size - written) {
        await response.body?.cancel();
        throw new RegistryError(
          `the registry sends ${declared} bytes of ${layer.digest}, which has ${layer.size - written} left`,
          { reason: declared > layer.size - written ? "too_large" : "malformed" },
        );
      }
      if (response.body !== null) {
        for await (const chunk of response.body) {
          restartTimer();
          if (written + chunk.byteLength > layer.size) {
            await response.body.cancel().catch(() => undefined);
            throw new RegistryError(`${layer.digest} is longer than its ${layer.size} bytes`, {
              reason: "too_large",
            });
          }
          hash.update(chunk);
          await file.write(chunk, 0, chunk.byteLength, position + written);
          written += chunk.byteLength;
        }
      }
      if (written < layer.size) {
        throw new RegistryError(
          `${layer.digest} ended after ${written} of its ${layer.size} bytes`,
          { reason: "truncated", retryable: true },
        );
      }
      const digest = `sha256:${hash.digest("hex")}`;
      if (digest !== layer.digest) {
        throw new RegistryError(`a blob asked for as ${layer.digest} has the digest ${digest}`, {
          reason: "digest",
        });
      }
      return;
    } catch (caught) {
      if (signal.aborted) throw caught;
      const error =
        caught instanceof RegistryError
          ? caught
          : idle.signal.aborted
            ? new RegistryError(`no data of ${layer.digest} for ${idleTimeoutMs / 1000} s`, {
                reason: "timeout",
                retryable: true,
              })
            : caught instanceof Error && caught.name === "TimeoutError"
              ? new RegistryError(`${layer.digest} timed out`, {
                  reason: "timeout",
                  retryable: true,
                })
              : caught instanceof TypeError
                ? new RegistryError(
                    `the download of ${layer.digest} broke off after ${written} of ${layer.size} bytes`,
                    { reason: "truncated", retryable: true, cause: caught },
                  )
                : caught;
      if (!(error instanceof RegistryError)) {
        // The volume, most likely: a write failed.
        throw new RegistryError(`writing ${layer.digest} failed: ${String(error)}`, {
          reason: "disk",
          cause: error,
        });
      }
      if (!error.retryable || attempt >= attempts) throw error;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      logger.warn(
        { digest: layer.digest, attempt, backoffMs: backoff, reason: error.reason, written },
        "map data download interrupted, resuming",
      );
      await pause(backoff, signal);
    } finally {
      clearTimeout(timer);
    }
  }
}
