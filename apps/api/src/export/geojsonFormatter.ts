import { toIso, toIsoOrNull } from "../db/toIso";
import type { ExportFormatter } from "./exportFormatter";
import type { ExportDevice, ExportRow } from "./exportRow";
import type { ExportTrip } from "./exportTrip";
import type { ExportVisit } from "./exportVisit";

/*
 * Points, visits and trips as a GeoJSON FeatureCollection with Overland's own
 * property names (a visit has `action: "visit"`, a trip `type: "trip"`), so an
 * export can be replayed into any Overland receiver. `kind` says what each
 * feature is. Unknown values are left out rather than written as null.
 */
const withoutNulls = (properties: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== null));

const point = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });

function locationFeature(device: ExportDevice, row: ExportRow): object {
  return {
    type: "Feature",
    geometry: point(row.lon, row.lat),
    properties: withoutNulls({
      ...row.extra,
      kind: "location",
      timestamp: toIso(row.recorded_at),
      device_id: device.deviceKey,
      device_name: device.name,
      altitude: row.altitude,
      speed: row.speed,
      course: row.course,
      horizontal_accuracy: row.horizontal_accuracy,
      vertical_accuracy: row.vertical_accuracy,
      speed_accuracy: row.speed_accuracy,
      course_accuracy: row.course_accuracy,
      motion: row.motion,
      battery_level: row.battery_level,
      battery_state: row.battery_state,
      wifi: row.wifi,
    }),
  };
}

function visitFeature(device: ExportDevice, visit: ExportVisit): object {
  return {
    type: "Feature",
    geometry: point(visit.lon, visit.lat),
    properties: withoutNulls({
      ...visit.extra,
      kind: "visit",
      action: "visit",
      timestamp: toIso(visit.recorded_at),
      arrival_date: toIsoOrNull(visit.arrived_at),
      departure_date: toIsoOrNull(visit.departed_at),
      horizontal_accuracy: visit.horizontal_accuracy,
      device_id: device.deviceKey,
      device_name: device.name,
    }),
  };
}

/** A GeoJSON geometry, if `value` is a Point with numeric coordinates. */
const pointGeometry = (value: unknown): object | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("type" in value) || value.type !== "Point" || !("coordinates" in value)) return null;
  const { coordinates } = value;
  return Array.isArray(coordinates) && coordinates.every((item) => typeof item === "number")
    ? { type: "Point", coordinates }
    : null;
};

const geometryOf = (location: unknown): object | null =>
  typeof location === "object" && location !== null && "geometry" in location
    ? pointGeometry(location.geometry)
    : null;

function tripFeature(device: ExportDevice, trip: ExportTrip): object {
  const { geometry, ...extra } = trip.extra ?? {};
  return {
    type: "Feature",
    // The trip record's own point (where it ended), else its end or start location.
    geometry:
      pointGeometry(geometry) ?? geometryOf(trip.end_location) ?? geometryOf(trip.start_location),
    properties: withoutNulls({
      ...extra,
      kind: "trip",
      type: "trip",
      mode: trip.mode,
      start: toIso(trip.started_at),
      end: toIso(trip.ended_at),
      distance: trip.distance_m,
      duration: trip.duration_s,
      steps: trip.steps,
      stopped_automatically: trip.stopped_automatically,
      start_location: trip.start_location,
      end_location: trip.end_location,
      device_id: device.deviceKey,
      device_name: device.name,
    }),
  };
}

export function geojsonFormatter(): ExportFormatter {
  let written = 0;
  const features = (items: readonly object[]): string =>
    items
      .map((item) => {
        const separator = written === 0 ? "" : ",\n";
        written += 1;
        return separator + JSON.stringify(item);
      })
      .join("");
  return {
    contentType: "application/geo+json; charset=utf-8",
    extension: "geojson",
    begin: () => '{"type":"FeatureCollection","features":[\n',
    visits: (device, visits) => features(visits.map((visit) => visitFeature(device, visit))),
    trips: (device, trips) => features(trips.map((trip) => tripFeature(device, trip))),
    rows: (device, rows) => features(rows.map((row) => locationFeature(device, row))),
    endDevice: () => "",
    end: () => "\n]}\n",
  };
}
