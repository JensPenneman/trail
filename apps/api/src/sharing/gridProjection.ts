import { createHmac } from "node:crypto";
import type { PersonLocation } from "@trail/contracts/person";
import type { SharePrecision } from "@trail/contracts/share";

/** Height of a cell in degrees of latitude; its width matches it in metres. */
export const gridDegrees = { approximate: 0.005, area: 0.05 } as const;

/** Metres per degree of latitude on the sphere that `haversineM` uses. */
const metresPerDegree = 111_195;

/** Near the poles a cell would span the globe; it stops widening here (about ±89.4°). */
const minLongitudeScale = 0.01;

/** Fractions of a cell, in [0, 1): where this grid's lines lie. */
export interface GridOffset {
  readonly lat: number;
  readonly lon: number;
}

/** What a grid belongs to: a share with a person, or a public link. */
export type GridScope = "share" | "link";

/**
 * The offset of one device's grid for one share or link: an HMAC of their ids
 * under the server's own secret key. It is fixed (the same cell for the same
 * position, read after read, so averaging gains nothing), differs per share
 * and device, and cannot be worked out from anything public.
 */
export function gridOffset(
  key: Buffer,
  scope: GridScope,
  grantId: string,
  deviceId: string,
): GridOffset {
  const digest = createHmac("sha256", key)
    .update(`trail/share-grid/v1\0${scope}\0${grantId}\0${deviceId}`)
    .digest();
  return { lat: digest.readUInt32BE(0) / 2 ** 32, lon: digest.readUInt32BE(4) / 2 ** 32 };
}

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

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Longitude in [-180, 180). */
const wrapLongitude = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

const rounded = (degrees: number): number => Math.round(degrees * 1e6) / 1e6;

/**
 * The centre of the grid cell around a position. Rows are `size` degrees of
 * latitude; each row's columns are as wide in metres as the row is high, so a
 * cell covers about the same ground at any latitude. Every position inside a
 * cell maps to the same centre.
 */
export function gridCellCentre(
  lat: number,
  lon: number,
  size: number,
  offset: GridOffset,
): { lat: number; lon: number } {
  const row = Math.floor(lat / size - offset.lat);
  const centreLat = (row + offset.lat + 0.5) * size;
  const width = size / Math.max(Math.cos(toRadians(centreLat)), minLongitudeScale);
  const column = Math.floor(lon / width - offset.lon);
  const centreLon = (column + offset.lon + 0.5) * width;
  return {
    lat: rounded(Math.min(90, Math.max(-90, centreLat))),
    lon: rounded(wrapLongitude(centreLon)),
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
 * A position at a share's precision (docs/architecture.md §8.4). Precise
 * passes it on. Approximate and area give the centre of the cell, with the
 * cell size as accuracy (or the fix's own, if worse), and leave out what
 * would narrow it down again: the altitude and the course for both, the speed
 * too for area.
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
  const centre = gridCellCentre(position.lat, position.lon, gridDegrees[precision], offset);
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
