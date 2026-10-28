import { describe, expect, it } from "vitest";
import { boundedLines } from "../../src/mapdata/boundedLines";
import { MapDataError } from "../../src/mapdata/mapDataError";

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield Buffer.from(part, "utf8");
}

const read = async (source: AsyncIterable<Uint8Array>, maxLineBytes = 100, maxBytes = 1000) => {
  const lines: string[] = [];
  for await (const batch of boundedLines(source, "test.txt", { maxLineBytes, maxBytes })) {
    lines.push(...batch);
  }
  return lines;
};

describe("boundedLines", () => {
  it("joins lines across chunks, a character split between two of them too", async () => {
    const text = Buffer.from("één\ntwee\ndrie", "utf8");
    async function* split(): AsyncGenerator<Uint8Array> {
      yield text.subarray(0, 1);
      yield text.subarray(1, 7);
      yield text.subarray(7);
    }
    expect(await read(split())).toEqual(["één", "twee", "drie"]);
    expect(await read(chunks("a\n", "\n", "b\n"))).toEqual(["a", "", "b"]);
  });

  it("stops at a line or a text beyond its limits", async () => {
    await expect(read(chunks("x".repeat(101), "\n"))).rejects.toThrow(MapDataError);
    await expect(read(chunks("x".repeat(60), "x".repeat(60)))).rejects.toThrow(
      /longer than 100 bytes/,
    );
    await expect(
      read(chunks(...Array.from({ length: 30 }, () => `${"y".repeat(40)}\n`))),
    ).rejects.toThrow(/unpacks to more than 1000 bytes/);
  });
});
