import { gzipSync } from "node:zlib";
import { zxyToTileId } from "pmtiles";

/** A tile of a test archive: its numbers and its bytes, as the archive stores them. */
export interface TestTile {
  z: number;
  x: number;
  y: number;
  data: Buffer;
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
};

/** A directory as PMTiles v3 serialises it: ids as deltas, then run lengths, lengths, offsets. */
function directory(entries: readonly Entry[]): Buffer {
  const bytes = [...varint(entries.length)];
  let last = 0;
  for (const entry of entries) {
    bytes.push(...varint(entry.tileId - last));
    last = entry.tileId;
  }
  for (const entry of entries) bytes.push(...varint(entry.runLength));
  for (const entry of entries) bytes.push(...varint(entry.length));
  for (const entry of entries) bytes.push(...varint(entry.offset + 1));
  return Buffer.from(bytes);
}

const u64 = (buffer: Buffer, offset: number, value: number) => {
  buffer.writeUInt32LE(value % 2 ** 32, offset);
  buffer.writeUInt32LE(Math.floor(value / 2 ** 32), offset + 4);
};

/**
 * A small PMTiles v3 archive for the tests of the tile router: the tiles as
 * given (gzipped unless `compression` is `none`), their directory gzipped, and
 * with `leaf: true` the entries in a leaf directory the root points to, as
 * an archive too large for one root directory has them. `header` changes the
 * header's bytes afterwards (a damaged or foreign archive).
 */
export function writePmtiles(input: {
  tiles: readonly TestTile[];
  leaf?: boolean;
  compression?: "gzip" | "none";
  tileType?: number;
  header?: (header: Buffer) => void;
}): Buffer {
  const compression = input.compression ?? "gzip";
  const sorted = [...input.tiles]
    .map((tile) => ({ ...tile, tileId: zxyToTileId(tile.z, tile.x, tile.y) }))
    .sort((a, b) => a.tileId - b.tileId);
  const datas: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  for (const tile of sorted) {
    const data = compression === "gzip" ? gzipSync(tile.data) : tile.data;
    entries.push({ tileId: tile.tileId, offset, length: data.length, runLength: 1 });
    datas.push(data);
    offset += data.length;
  }
  const tileData = Buffer.concat(datas);
  let root: Buffer;
  let leaves = Buffer.alloc(0);
  if (input.leaf === true) {
    leaves = gzipSync(directory(entries));
    const first = entries[0]?.tileId ?? 0;
    root = gzipSync(directory([{ tileId: first, offset: 0, length: leaves.length, runLength: 0 }]));
  } else {
    root = gzipSync(directory(entries));
  }
  const zooms = sorted.map((tile) => tile.z);
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii");
  header.writeUInt8(3, 7);
  const rootOffset = 127;
  const leafOffset = rootOffset + root.length;
  const tileOffset = leafOffset + leaves.length;
  const metadataOffset = tileOffset + tileData.length;
  u64(header, 8, rootOffset);
  u64(header, 16, root.length);
  u64(header, 24, metadataOffset);
  u64(header, 32, 0);
  u64(header, 40, leafOffset);
  u64(header, 48, leaves.length);
  u64(header, 56, tileOffset);
  u64(header, 64, tileData.length);
  u64(header, 72, entries.length);
  u64(header, 80, entries.length);
  u64(header, 88, entries.length);
  header.writeUInt8(1, 96);
  header.writeUInt8(2, 97);
  header.writeUInt8(compression === "gzip" ? 2 : 1, 98);
  header.writeUInt8(input.tileType ?? 1, 99);
  header.writeUInt8(zooms.length === 0 ? 0 : Math.min(...zooms), 100);
  header.writeUInt8(zooms.length === 0 ? 0 : Math.max(...zooms), 101);
  header.writeInt32LE(-1_800_000_000, 102);
  header.writeInt32LE(-850_000_000, 106);
  header.writeInt32LE(1_800_000_000, 110);
  header.writeInt32LE(850_000_000, 114);
  input.header?.(header);
  return Buffer.concat([header, root, leaves, tileData]);
}
