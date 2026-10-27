import type { BatteryReading } from "../ingest/batteryReading";
import { checkCoordinates } from "../ingest/checkCoordinates";
import {
  asRecord,
  batteryLevelOf,
  extraOf,
  finiteOrNull,
  nonNegativeRealOrNull,
  positiveRealOrNull,
  realOrNull,
} from "../ingest/ingestValues";
import { type Normalised, rejected } from "../ingest/normalised";
import { recordTime } from "../ingest/recordTime";
import { withoutSecrets } from "../ingest/withoutSecrets";
import type { OsmandPoint } from "./normaliseOsmandPoint";

/*
 * The activity of Android's and iOS's motion detection as Transistorsoft's
 * plugin reports it, in CoreMotion's words — the ones Overland sends and
 * transport inference reads (`processing/motionActivity.ts`).
 */
const activities: Readonly<Record<string, string>> = {
  still: "stationary",
  on_foot: "walking",
  walking: "walking",
  running: "running",
  on_bicycle: "cycling",
  in_vehicle: "automotive",
};

/*
 * Read into columns. `_` is Traccar Client 9's copy of the position as query
 * text for older servers, the device identifier — the token — included.
 */
const mapped = new Set(["timestamp", "coords", "battery", "_"]);

/**
 * One location of Traccar Client 9's JSON body — the format of Transistorsoft's
 * background-geolocation plugin, which Traccar's server reads as well:
 * `{ device_id, location: { timestamp, coords, battery, activity, … } }`.
 * Its units are the plugin's, whatever the app: speed in m/s, battery 0..1,
 * negative readings unknown. A location without `coords` is a heartbeat.
 */
export function normaliseTraccarLocation(
  entry: unknown,
  receivedAt: Date,
): Normalised<OsmandPoint> {
  const location = asRecord(entry);
  if (location === null) return rejected("location is not an object");
  const time = recordTime(location["timestamp"], receivedAt);
  if (!time.ok) return rejected(time.reason);

  const batteryRecord = asRecord(location["battery"]);
  const level = batteryLevelOf(batteryRecord?.["level"]);
  const charging = batteryRecord?.["is_charging"];
  const state = typeof charging === "boolean" ? (charging ? "charging" : "unplugged") : null;
  const battery: BatteryReading | null =
    level === null && state === null ? null : { recordedAt: time.value, level, state };
  const extra = extraOf(withoutSecrets(location) as Record<string, unknown>, mapped);

  const coords = asRecord(location["coords"]);
  if (coords === null) {
    return {
      ok: true,
      value: {
        location: null,
        events: [
          { recordedAt: time.value, action: "heartbeat", lat: null, lon: null, extra, battery },
        ],
        battery,
      },
    };
  }
  const coordinates = checkCoordinates(
    finiteOrNull(coords["latitude"]),
    finiteOrNull(coords["longitude"]),
  );
  if (!coordinates.ok) return rejected(coordinates.reason);
  const altitudeAccuracy = finiteOrNull(coords["altitude_accuracy"]);
  const activity = asRecord(location["activity"])?.["type"];
  const motion = typeof activity === "string" ? activities[activity] : undefined;
  return {
    ok: true,
    value: {
      location: {
        recordedAt: time.value,
        lat: coordinates.lat,
        lon: coordinates.lon,
        // A negative vertical accuracy means the altitude itself is invalid (iOS).
        altitude:
          altitudeAccuracy !== null && altitudeAccuracy < 0 ? null : realOrNull(coords["altitude"]),
        speed: nonNegativeRealOrNull(coords["speed"]),
        course: nonNegativeRealOrNull(coords["heading"]),
        horizontalAccuracy: positiveRealOrNull(coords["accuracy"]),
        verticalAccuracy: positiveRealOrNull(altitudeAccuracy),
        speedAccuracy: positiveRealOrNull(coords["speed_accuracy"]),
        courseAccuracy: positiveRealOrNull(coords["heading_accuracy"]),
        motion: motion === undefined ? [] : [motion],
        batteryLevel: level,
        batteryState: state,
        wifi: null,
        extra,
        battery,
      },
      events: [],
      battery,
    },
  };
}
