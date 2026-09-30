import type { Writable } from "node:stream";

/**
 * Writes one chunk and, when the socket buffer is full, waits for `drain`
 * (backpressure). Resolves false when the client went away, so the producer
 * can stop instead of buffering a whole export in memory.
 */
export function writeChunk(stream: Writable, chunk: string): Promise<boolean> {
  if (stream.destroyed || stream.writableEnded) return Promise.resolve(false);
  if (stream.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      stream.off("close", onClose);
      resolve(value);
    };
    const onClose = () => settle(false);
    // `once` so the listener removes itself even where a middleware (compression)
    // re-routes `drain` listeners to its own stream.
    stream.once("drain", () => settle(true));
    stream.on("close", onClose);
  });
}
