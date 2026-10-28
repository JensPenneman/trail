import type { HeatmapResponse } from "@trail/contracts/heatmap";
import type { TrackPoint } from "@trail/contracts/track";
import type { LevelPoint } from "@trail/contracts/transport";

/**
 * Rows of numbers packed into one buffer, column after column: `n` rows of
 * `width` numbers as 64-bit floats, null as NaN. An array of 8 000 six-number
 * tuples is some 50 000 objects for IndexedDB to clone, write, read and clone
 * again; one ArrayBuffer is a copy. 64 bits for every column, so the numbers
 * come back exactly as the server sent them: 32-bit floats would turn a speed
 * of 5.3 into 5.300000190734863, and 32-bit seconds end in 2038.
 */
export interface PackedRows {
  packed: ArrayBuffer;
  n: number;
  width: number;
}

type Row = readonly (number | null)[];

function packRows(rows: readonly Row[], width: number): PackedRows {
  const n = rows.length;
  const columns = new Float64Array(n * width);
  for (let index = 0; index < n; index += 1) {
    const row = rows[index] as Row;
    for (let column = 0; column < width; column += 1) {
      columns[column * n + index] = row[column] ?? Number.NaN;
    }
  }
  return { packed: columns.buffer, n, width };
}

/** An ArrayBuffer, also one a structured clone made in another realm (`instanceof` would say no). */
export const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  Object.prototype.toString.call(value) === "[object ArrayBuffer]";

const isPacked = (value: unknown, width: number): value is PackedRows => {
  if (typeof value !== "object" || value === null) return false;
  if (!("packed" in value) || !("n" in value) || !("width" in value)) return false;
  return (
    isArrayBuffer(value.packed) &&
    typeof value.n === "number" &&
    Number.isInteger(value.n) &&
    value.n >= 0 &&
    value.width === width &&
    value.packed.byteLength === value.n * width * Float64Array.BYTES_PER_ELEMENT
  );
};

/** The columns of a packed body: one view per column, no copy. */
function columnsOf(value: unknown, width: number): Float64Array[] | null {
  if (!isPacked(value, width)) return null;
  const { n } = value;
  return Array.from(
    { length: width },
    (_, column) => new Float64Array(value.packed, column * n * Float64Array.BYTES_PER_ELEMENT, n),
  );
}

const orNull = (number: number): number | null => (Number.isNaN(number) ? null : number);

/** `[lon, lat, t, speed, accuracy, altitude]`, the last three nullable: 48 bytes a point. */
export const packTrackPoints = (points: readonly TrackPoint[]): PackedRows => packRows(points, 6);

/**
 * The tuples for the contract's schema to check, or null when `value` is not
 * what the packer made. NaN stands for null only where a column may be null:
 * elsewhere it stays NaN, which the schema refuses, so a damaged entry never
 * passes for an answer. Tuples are written whole (array literals), the way
 * the engine builds them fastest: 50 000 points in a few milliseconds.
 */
export function unpackTrackPoints(value: unknown): unknown[] | null {
  const columns = columnsOf(value, 6);
  if (columns === null) return null;
  const [lon, lat, t, speed, accuracy, altitude] = columns as [
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
  ];
  const rows: unknown[] = new Array(lon.length);
  for (let index = 0; index < lon.length; index += 1) {
    rows[index] = [
      lon[index],
      lat[index],
      t[index],
      orNull(speed[index] as number),
      orNull(accuracy[index] as number),
      orNull(altitude[index] as number),
    ];
  }
  return rows;
}

export const packLevelPoints = (points: readonly LevelPoint[]): PackedRows => packRows(points, 3);

/** Three numbers, none of them nullable: level points and heat cells. */
function unpackTriples(value: unknown): unknown[] | null {
  const columns = columnsOf(value, 3);
  if (columns === null) return null;
  const [first, second, third] = columns as [Float64Array, Float64Array, Float64Array];
  const rows: unknown[] = new Array(first.length);
  for (let index = 0; index < first.length; index += 1) {
    rows[index] = [first[index], second[index], third[index]];
  }
  return rows;
}

export const unpackLevelPoints = (value: unknown): unknown[] | null => unpackTriples(value);

export const packHeatCells = (cells: HeatmapResponse["cells"]): PackedRows => packRows(cells, 3);

export const unpackHeatCells = (value: unknown): unknown[] | null => unpackTriples(value);
