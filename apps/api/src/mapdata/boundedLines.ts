import { MapDataError } from "./mapDataError";

export interface LineLimits {
  /** The longest line, in bytes. */
  maxLineBytes: number;
  /** All of the text, in bytes: what a small compressed file may unpack to at most. */
  maxBytes: number;
}

/**
 * The lines of a stream of UTF-8 text, a chunk's worth at a time. It never
 * holds more than a chunk and the line that runs over its end, so a file may
 * be far bigger than memory; a line, or the whole text, beyond the limits
 * stops the read (a decompression bomb, a file without line breaks).
 */
export async function* boundedLines(
  chunks: AsyncIterable<Uint8Array>,
  file: string,
  limits: LineLimits,
): AsyncGenerator<string[]> {
  let carry: Buffer | null = null;
  let total = 0;
  const tooLong = () =>
    new MapDataError(`${file} has a line longer than ${limits.maxLineBytes} bytes`);
  for await (const chunk of chunks) {
    total += chunk.byteLength;
    if (total > limits.maxBytes) {
      throw new MapDataError(`${file} unpacks to more than ${limits.maxBytes} bytes`);
    }
    const piece = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const text: Buffer = carry === null ? piece : Buffer.concat([carry, piece]);
    const lines: string[] = [];
    let start = 0;
    for (let end = text.indexOf(10, start); end !== -1; end = text.indexOf(10, start)) {
      if (end - start > limits.maxLineBytes) throw tooLong();
      lines.push(text.toString("utf8", start, end));
      start = end + 1;
    }
    carry = start < text.length ? text.subarray(start) : null;
    if (carry !== null && carry.length > limits.maxLineBytes) throw tooLong();
    if (lines.length > 0) yield lines;
  }
  if (carry !== null) yield [carry.toString("utf8")];
}
