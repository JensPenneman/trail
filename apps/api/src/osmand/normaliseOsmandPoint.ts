import type { BatteryReading } from "../ingest/batteryReading";
import { checkCoordinates } from "../ingest/checkCoordinates";
import {
  batteryPercentOf,
  extraOf,
  nonNegativeRealOrNull,
  positiveRealOrNull,
  realOrNull,
  textOrNull,
} from "../ingest/ingestValues";
import { type Normalised, rejected } from "../ingest/normalised";
import type { NormalisedEvent, NormalisedLocation } from "../ingest/normalisedRecords";
import { checkRecordTime } from "../ingest/recordTime";
import { withoutSecrets } from "../ingest/withoutSecrets";
import { type OsmandApp, speedToMetresPerSecond } from "./osmandApps";
import { tokenParameters } from "./osmandToken";
import { booleanOf, decimalOf, timestampOf } from "./osmandValues";

/** What one request in the OsmAnd format stores: a point or a heartbeat, and an alarm. */
export interface OsmandPoint {
  location: NormalisedLocation | null;
  events: NormalisedEvent[];
  battery: BatteryReading | null;
}

/** Read into columns; everything else (`hdop`, `sat`, `cell`, `wifi`, `driverUniqueId` …) goes to `extra`. */
const columnParameters = [
  "lat",
  "lon",
  "location",
  "timestamp",
  "valid",
  "speed",
  "bearing",
  "heading",
  "altitude",
  "accuracy",
  "batt",
  "batproc",
  "charge",
];

/** The parameters without the device token, for `extra` and the dead letter. */
export function storableParameters(params: ReadonlyMap<string, string>): Record<string, unknown> {
  const credentials = new Set<string>(tokenParameters);
  const kept = [...params].filter(([name]) => !credentials.has(name.toLowerCase()));
  return withoutSecrets(Object.fromEntries(kept)) as Record<string, unknown>;
}

const coordinatesOf = (
  params: ReadonlyMap<string, string>,
): [string | undefined, string | undefined] => {
  const location = params.get("location");
  if (
    params.get("lat") === undefined &&
    params.get("lon") === undefined &&
    location !== undefined
  ) {
    const [lat, lon] = location.split(",");
    return [lat, lon];
  }
  return [params.get("lat"), params.get("lon")];
};

/**
 * One position in the OsmAnd format (docs/architecture.md §6.6): Traccar's
 * parameters, read with the units of the device's app. A request without a
 * position — Traccar Client's heartbeat while it stands still and has no fix —
 * is a `heartbeat` event, with the battery; `alarm` (Traccar Client's SOS)
 * adds an `alarm` event. A position the app itself marks `valid=false` and
 * one without a time are rejected: Trail never makes up an instant.
 */
export function normaliseOsmandPoint(
  params: ReadonlyMap<string, string>,
  app: OsmandApp,
  receivedAt: Date,
): Normalised<OsmandPoint> {
  if (booleanOf(params.get("valid")) === false) {
    return rejected("the app marked the position as invalid");
  }
  const timestamp = params.get("timestamp");
  if (timestamp === undefined || timestamp.trim() === "") return rejected("missing timestamp");
  const at = timestampOf(timestamp);
  if (at === null) return rejected("invalid timestamp");
  const time = checkRecordTime(at, receivedAt);
  if (!time.ok) return rejected(time.reason);

  const level = batteryPercentOf(decimalOf(params.get("batt") ?? params.get("batproc")));
  const charging = booleanOf(params.get("charge"));
  const state = charging === null ? null : charging ? "charging" : "unplugged";
  const battery: BatteryReading | null =
    level === null && state === null ? null : { recordedAt: time.value, level, state };

  // OsmAnd's {3}, which Traccar's examples call hdop, is the fix's accuracy in metres.
  const hdopIsAccuracy = app === "osmand" && params.get("accuracy") === undefined;
  const mapped = new Set([
    ...tokenParameters,
    ...columnParameters,
    ...(hdopIsAccuracy ? ["hdop"] : []),
  ]);
  const extra = extraOf(storableParameters(params), mapped);

  const events: NormalisedEvent[] = [];
  const [latText, lonText] = coordinatesOf(params);
  const alarm = textOrNull(params.get("alarm"));
  const eventAt = (action: string, lat: number | null, lon: number | null): NormalisedEvent => ({
    recordedAt: time.value,
    action,
    lat,
    lon,
    extra,
    battery,
  });

  if (latText === undefined && lonText === undefined) {
    events.push(eventAt("heartbeat", null, null));
    if (alarm !== null) events.push(eventAt("alarm", null, null));
    return { ok: true, value: { location: null, events, battery } };
  }
  const coordinates = checkCoordinates(decimalOf(latText), decimalOf(lonText));
  if (!coordinates.ok) return rejected(coordinates.reason);
  if (alarm !== null) events.push(eventAt("alarm", coordinates.lat, coordinates.lon));

  const speed = nonNegativeRealOrNull(decimalOf(params.get("speed")));
  return {
    ok: true,
    value: {
      location: {
        recordedAt: time.value,
        lat: coordinates.lat,
        lon: coordinates.lon,
        altitude: realOrNull(decimalOf(params.get("altitude"))),
        speed: speed === null ? null : speed * speedToMetresPerSecond[app],
        course: nonNegativeRealOrNull(decimalOf(params.get("bearing") ?? params.get("heading"))),
        horizontalAccuracy: positiveRealOrNull(
          decimalOf(params.get("accuracy") ?? (hdopIsAccuracy ? params.get("hdop") : undefined)),
        ),
        verticalAccuracy: null,
        speedAccuracy: null,
        courseAccuracy: null,
        motion: [],
        batteryLevel: level,
        batteryState: state,
        // The format's `wifi` is an access point (MAC and signal), not a network's name: it stays in extra.
        wifi: null,
        extra,
        battery,
      },
      events,
      battery,
    },
  };
}
