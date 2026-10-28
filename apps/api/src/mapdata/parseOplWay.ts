import { keptWayTags } from "../processing/keptWayTags";
import { decodeOplText } from "./oplText";

/** As `parseOverpassResponse`: more is not a way people travel on. */
export const maxNodesPerWay = 10_000;

const kept: ReadonlySet<string> = new Set(keptWayTags);
/** 10^(7 − decimals): a coordinate's fraction in 1e-7 degrees. */
const fractionScale = [10_000_000, 1_000_000, 100_000, 10_000, 1000, 100, 10, 1];
const maxLonE7 = 1_800_000_000;
const maxLatE7 = 900_000_000;
/** OSM ids stay far below 2^53; fifteen digits keep them exact. */
const maxIdDigits = 15;

/** A way of ways.opl.gz: its id, the tags Trail keeps, its nodes and their positions. */
interface OplWay {
  id: number;
  /** Only the keys of `keptWayTags`. */
  tags: Record<string, string>;
  nodes: number[];
  /** Longitude and latitude of each node in 1e-7 degrees, interleaved. */
  lonLatE7: Int32Array;
}

export type OplWayLine = { ok: true; way: OplWay } | { ok: false; reason: string };

const malformed = (reason: string): OplWayLine => ({ ok: false, reason });

/** A positive id without a sign or leading zero, or -1. */
function parseId(text: string, start: number, end: number): number {
  if (end <= start || end - start > maxIdDigits || text.charCodeAt(start) === 48) return -1;
  let id = 0;
  for (let index = start; index < end; index += 1) {
    const digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return -1;
    id = id * 10 + digit;
  }
  return id;
}

/**
 * A coordinate as osmium writes it (`-0.1234567`: at most three digits, a
 * point, at most seven decimals, no exponent) in 1e-7 degrees, exactly; NaN
 * for anything else.
 */
function parseCoordinateE7(text: string, start: number, end: number): number {
  let index = start;
  const negative = text.charCodeAt(index) === 45;
  if (negative) index += 1;
  let whole = 0;
  let digits = 0;
  for (; index < end; index += 1) {
    const digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) break;
    whole = whole * 10 + digit;
    digits += 1;
  }
  if (digits === 0 || digits > 3) return Number.NaN;
  let fraction = 0;
  let decimals = 0;
  if (index < end) {
    if (text.charCodeAt(index) !== 46) return Number.NaN;
    for (index += 1; index < end; index += 1) {
      const digit = text.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9) return Number.NaN;
      fraction = fraction * 10 + digit;
      decimals += 1;
    }
    if (decimals === 0 || decimals > 7) return Number.NaN;
  }
  const value = whole * 10_000_000 + fraction * (fractionScale[decimals] ?? 0);
  return negative ? -value : value;
}

function parseTags(field: string, tags: Record<string, string>): boolean {
  for (let start = 0; start < field.length; ) {
    let end = field.indexOf(",", start);
    if (end === -1) end = field.length;
    const equals = field.indexOf("=", start);
    if (equals <= start || equals >= end) return false;
    const key = decodeOplText(field.slice(start, equals));
    const value = decodeOplText(field.slice(equals + 1, end));
    if (key === null || value === null) return false;
    // Only the kept keys are stored: no key of the file ever names a property of its own.
    if (kept.has(key)) tags[key] = value;
    start = end + 1;
  }
  return true;
}

/**
 * One line of ways.opl.gz (docs/design/self-hosted-maps.md §2.2), as
 * `osmium cat -f opl,add_metadata=false,locations_on_ways=true` and
 * keep-tags.awk write it: `w<id> T<k>=<v>,… N<n<id>x<lon>y<lat>>,…`. Strict,
 * per line: a way with a node without a position, fewer than two nodes or
 * more than `maxNodesPerWay`, a broken escape or a field Trail does not know
 * is malformed, and only that way is dropped.
 */
export function parseOplWay(line: string): OplWayLine {
  if (line.charCodeAt(0) !== 119) return malformed("not a way");
  let id = -1;
  let tagsField = "";
  let nodesField: string | null = null;
  for (let start = 0; start < line.length; ) {
    let end = line.indexOf(" ", start);
    if (end === -1) end = line.length;
    switch (start === 0 ? -1 : line.charCodeAt(start)) {
      case -1:
        id = parseId(line, 1, end);
        break;
      case 84: // T
        tagsField = line.slice(start + 1, end);
        break;
      case 78: // N
        nodesField = line.slice(start + 1, end);
        break;
      // the metadata osmium writes without add_metadata=false: version, deleted, changeset, time, uid, user
      case 118:
      case 100:
      case 99:
      case 116:
      case 105:
      case 117:
        break;
      default:
        return malformed("a field Trail does not know");
    }
    start = end + 1;
  }
  if (id < 0) return malformed("no way id");
  const tags: Record<string, string> = {};
  if (!parseTags(tagsField, tags)) return malformed("an unreadable tag");
  if (nodesField === null || nodesField.length === 0) return malformed("no nodes");

  let count = 1;
  for (
    let comma = nodesField.indexOf(",");
    comma !== -1;
    comma = nodesField.indexOf(",", comma + 1)
  ) {
    count += 1;
    if (count > maxNodesPerWay) return malformed(`more than ${maxNodesPerWay} nodes`);
  }
  if (count < 2) return malformed("fewer than two nodes");
  const nodes = new Array<number>(count);
  const lonLatE7 = new Int32Array(count * 2);
  let start = 0;
  for (let node = 0; node < count; node += 1) {
    let end = nodesField.indexOf(",", start);
    if (end === -1) end = nodesField.length;
    if (nodesField.charCodeAt(start) !== 110) return malformed("a node reference without n");
    const x = nodesField.indexOf("x", start + 1);
    const y = x === -1 ? -1 : nodesField.indexOf("y", x + 1);
    if (x === -1 || x >= end || y === -1 || y >= end) {
      return malformed("a node without a position");
    }
    const nodeId = parseId(nodesField, start + 1, x);
    const lon = parseCoordinateE7(nodesField, x + 1, y);
    const lat = parseCoordinateE7(nodesField, y + 1, end);
    if (nodeId < 0) return malformed("a node without an id");
    if (!(Math.abs(lon) <= maxLonE7 && Math.abs(lat) <= maxLatE7)) {
      return malformed("a node without a position");
    }
    nodes[node] = nodeId;
    lonLatE7[node * 2] = lon;
    lonLatE7[node * 2 + 1] = lat;
    start = end + 1;
  }
  return { ok: true, way: { id, tags, nodes, lonLatE7 } };
}
