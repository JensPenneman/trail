/**
 * The compact geometry of `osm_ways` (docs/architecture.md §5): a way's
 * positions as big-endian int32 pairs of longitude and latitude in 1e-7
 * degrees, OpenStreetMap's own precision. Eight bytes a vertex instead of
 * about 22 as JSON, and node-postgres hands the bytes over as hex, which
 * decodes about twice as fast as the JSON did (an int4[] would be ten times
 * slower). A coordinate of up to 7 decimals comes back exactly: the integer
 * over 1e7 is the double nearest the decimal.
 */
const scale = 10_000_000;
const vertexBytes = 8;
const maxLonE7 = 180 * scale;
const maxLatE7 = 90 * scale;

function fixed(value: number, maxE7: number): number {
  const scaled = Math.round(value * scale);
  if (!Number.isFinite(value) || Math.abs(scaled) > maxE7) {
    throw new RangeError(`${value} is not a coordinate`);
  }
  return scaled;
}

/** `[lon, lat]` positions in degrees, rounded to 1e-7. */
export function encodeGeometry(positions: readonly (readonly [number, number])[]): Buffer {
  const bytes = Buffer.allocUnsafe(positions.length * vertexBytes);
  for (const [index, [lon, lat]] of positions.entries()) {
    bytes.writeInt32BE(fixed(lon, maxLonE7), index * vertexBytes);
    bytes.writeInt32BE(fixed(lat, maxLatE7), index * vertexBytes + 4);
  }
  return bytes;
}

/** Positions already in 1e-7 degrees, longitude and latitude interleaved (as the loader parses them). */
export function encodeFixedGeometry(lonLatE7: Int32Array): Buffer {
  if (lonLatE7.length % 2 !== 0) throw new RangeError("a position has a longitude and a latitude");
  const bytes = Buffer.allocUnsafe(lonLatE7.length * 4);
  for (let index = 0; index < lonLatE7.length; index += 1) {
    bytes.writeInt32BE(lonLatE7[index] ?? 0, index * 4);
  }
  return bytes;
}

/** The `[lon, lat]` positions in degrees. */
export function decodeGeometry(bytes: Uint8Array): [number, number][] {
  if (bytes.byteLength % vertexBytes !== 0) {
    throw new RangeError(`${bytes.byteLength} bytes are no whole number of positions`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength / vertexBytes;
  const positions = new Array<[number, number]>(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * vertexBytes;
    positions[index] = [view.getInt32(offset) / scale, view.getInt32(offset + 4) / scale];
  }
  return positions;
}
