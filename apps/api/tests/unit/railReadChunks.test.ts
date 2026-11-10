import { describe, expect, it } from "vitest";
import { defaultProcessingConfig } from "../../src/processing/processingConfig";
import { railReadChunks } from "../../src/processing/tileStore";

const tiles = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `14/8000/${5000 + index}`);

describe("railReadChunks", () => {
  const cap = defaultProcessingConfig.rail.railOnlyMaxTiles;

  it("never reads more than the cap in one go, and every tile once", () => {
    const keys = tiles(256 + 7);
    const chunks = railReadChunks(keys, cap);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(cap);
    expect(chunks.flat().sort()).toEqual([...keys].sort());
  });

  it("reads a small piece in one go, and nothing for no tiles", () => {
    expect(railReadChunks(tiles(10), cap)).toHaveLength(1);
    expect(railReadChunks([], cap)).toEqual([]);
  });

  it("does not depend on the order the tiles come in", () => {
    const keys = tiles(150);
    expect(railReadChunks([...keys].reverse(), cap)).toEqual(railReadChunks(keys, cap));
  });
});
