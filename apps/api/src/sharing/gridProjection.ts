import { createHmac } from "node:crypto";
import type { PersonLocation } from "@trail/contracts/person";
import type { SharePrecision } from "@trail/contracts/share";

/** Height of an approximate cell in degrees of latitude; its width matches it in metres. */
const approximateDegrees = 0.005;
/** An area cell is an exact block of this many approximate cells across and down. */
const areaBlock = 10;

/** Cell heights in degrees of latitude. */
export const gridDegrees = {
  approximate: approximateDegrees,
  area: approximateDegrees * areaBlock,
} as const;

/** Metres per degree of latitude on the sphere that `haversineM` uses. */
const metresPerDegree = 111_195;

/** Fractions of an approximate cell, in [0, 1): where an owner's grid lines lie. */
export interface GridOffset {
  readonly lat: number;
  readonly lon: number;
}

/**
 * The offset of an owner's grid: an HMAC of the owner's id under the server's
 * own secret key. One grid per owner — for every device, share and link, and
 * both precisions — so whoever holds several of them (devices in one pocket,
 * a share again after a stop, several links, an approximate and an area share)
 * learns nothing that one of them does not already tell. It cannot be worked
 * out from anything public.
 */
export function ownerGridOffset(key: Buffer, ownerId: string): GridOffset {
  const digest = createHmac("sha256", key).update(`trail/share-grid/v2\0${ownerId}`).digest();
  return { lat: digest.readUInt32BE(0) / 2 ** 32, lon: digest.readUInt32BE(4) / 2 ** 32 };
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** `value` modulo `divisor`, never negative. */
const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

/** Longitude in [-180, 180). */
const wrapLongitude = (lon: number): number => mod(lon + 180, 360) - 180;

const rounded = (degrees: number): number => Math.round(degrees * 1e6) / 1e6;

/**
 * The centre of the grid cell around a position. Rows are 0.005° of latitude;
 * ten of them form a band, and each band is divided into a whole number of
 * columns — a multiple of ten, so that an area cell is exactly ten by ten
 * approximate cells — about as wide in metres as the rows are high. Whole
 * columns tile the full circle, so the cell at the antimeridian is as large as
 * any other. Every position inside a cell maps to the same centre.
 */
export function gridCellCentre(
  lat: number,
  lon: number,
  precision: Exclude<SharePrecision, "precise">,
  offset: GridOffset,
): { lat: number; lon: number } {
  const row = Math.floor(lat / approximateDegrees - offset.lat);
  const band = Math.floor(row / areaBlock);
  const bandCentreLat = (band * areaBlock + areaBlock / 2 + offset.lat) * approximateDegrees;
  const blocksAround = Math.max(
    1,
    Math.round((360 * Math.cos(toRadians(bandCentreLat))) / gridDegrees.area),
  );
  const columns = blocksAround * areaBlock;
  const width = 360 / columns;
  const column = mod(Math.floor((lon + 180) / width - offset.lon), columns);
  if (precision === "approximate") {
    return {
      lat: rounded(Math.min(90, Math.max(-90, (row + 0.5 + offset.lat) * approximateDegrees))),
      lon: rounded(wrapLongitude((column + 0.5 + offset.lon) * width - 180)),
    };
  }
  const blockColumn = Math.floor(column / areaBlock);
  return {
    lat: rounded(Math.min(90, Math.max(-90, bandCentreLat))),
    lon: rounded(
      wrapLongitude((blockColumn * areaBlock + areaBlock / 2 + offset.lon) * width - 180),
    ),
  };
}

/** A device's newest recorded position, as the device cache holds it. */
export interface RecordedPosition {
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: Date;
  speed: number | null;
  course: number | null;
  altitude: number | null;
}

/** The size of a cell in metres: the accuracy a coarsened position reports at the least. */
export const cellMetres = (precision: Exclude<SharePrecision, "precise">): number =>
  Math.round(gridDegrees[precision] * metresPerDegree);

/**
 * What a public page calls a device: stable for the link, unrelated to the
 * device's id (which would date the device and name it across links).
 */
export function publicDeviceKey(key: Buffer, linkId: string, deviceId: string): string {
  return createHmac("sha256", key)
    .update(`trail/share-link-device/v1\0${linkId}\0${deviceId}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * A position at a share's precision (docs/architecture.md §8.4). Precise
 * passes it on. Approximate and area give the centre of the owner's grid cell,
 * with the cell size as accuracy (or the fix's own, if worse), and leave out
 * what would narrow it down again: the altitude and the course for both, the
 * speed too for area.
 */
export function projectPosition(
  position: RecordedPosition,
  precision: SharePrecision,
  offset: GridOffset,
): PersonLocation {
  const recordedAt = position.recordedAt.toISOString();
  if (precision === "precise") {
    return {
      lat: position.lat,
      lon: position.lon,
      accuracy: position.accuracy,
      recordedAt,
      speed: position.speed,
      course: position.course,
      altitude: position.altitude,
      precision,
    };
  }
  const centre = gridCellCentre(position.lat, position.lon, precision, offset);
  return {
    lat: centre.lat,
    lon: centre.lon,
    accuracy: Math.max(cellMetres(precision), Math.round(position.accuracy ?? 0)),
    recordedAt,
    speed: precision === "approximate" ? position.speed : null,
    course: null,
    altitude: null,
    precision,
  };
}
