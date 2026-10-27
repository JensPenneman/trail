import { checkCoordinates } from "../ingest/checkCoordinates";
import {
  batteryPercentOf,
  extraOf,
  finiteOrNull,
  nonNegativeRealOrNull,
  positiveRealOrNull,
  realOrNull,
  stringArrayOf,
  textOrNull,
} from "../ingest/ingestValues";
import { type Normalised, rejected } from "../ingest/normalised";
import type { NormalisedLocation } from "../ingest/normalisedRecords";
import { checkRecordTime } from "../ingest/recordTime";
import { batteryStatusOf, epochSecondsOf, speedOf } from "./owntracksValues";

/*
 * Stored in columns; everything else — trigger `t`, `tid`, `topic`, `conn`,
 * `BSSID`, monitoring mode `m`, `inregions`, `inrids`, `created_at`,
 * pressure `p`, `poi`, `tag` … — goes to `extra` under its own name.
 */
const mapped = new Set([
  "_type",
  "lat",
  "lon",
  "tst",
  "acc",
  "alt",
  "vac",
  "vel",
  "cog",
  "batt",
  "bs",
  "SSID",
  "ssid",
  "motionactivities",
]);

/**
 * An OwnTracks `_type: location` message (owntracks.org/booklet/tech/json).
 * Both apps leave out what they do not know: Android every reading that is 0,
 * iOS the negative ones. iOS sends `alt` without `vac` when the altitude is
 * invalid (its vertical accuracy is negative), so an altitude of exactly 0
 * without a vertical accuracy is no reading; Android never sends 0. The
 * message comes without its secrets (`prepareOwnTracks`).
 */
export function normaliseOwnTracksLocation(
  message: Record<string, unknown>,
  receivedAt: Date,
): Normalised<NormalisedLocation> {
  const coordinates = checkCoordinates(finiteOrNull(message["lat"]), finiteOrNull(message["lon"]));
  if (!coordinates.ok) return rejected(coordinates.reason);
  if (message["tst"] === undefined || message["tst"] === null) return rejected("missing tst");
  const fix = epochSecondsOf(message["tst"]);
  if (fix === null) return rejected("invalid tst");
  const time = checkRecordTime(fix, receivedAt);
  if (!time.ok) return rejected(time.reason);

  const verticalAccuracy = positiveRealOrNull(message["vac"]);
  const altitude = realOrNull(message["alt"]);
  const batteryLevel = batteryPercentOf(message["batt"]);
  const batteryState = batteryStatusOf(message["bs"]);
  return {
    ok: true,
    value: {
      recordedAt: time.value,
      lat: coordinates.lat,
      lon: coordinates.lon,
      altitude: altitude === 0 && verticalAccuracy === null ? null : altitude,
      speed: speedOf(message["vel"]),
      course: nonNegativeRealOrNull(message["cog"]),
      horizontalAccuracy: positiveRealOrNull(message["acc"]),
      verticalAccuracy,
      speedAccuracy: null,
      courseAccuracy: null,
      // iOS's CoreMotion words, the ones Overland sends: `walking`, `automotive` …
      motion: stringArrayOf(message["motionactivities"]),
      batteryLevel,
      batteryState,
      // Android writes `SSID`, iOS `ssid`.
      wifi: textOrNull(message["SSID"]) ?? textOrNull(message["ssid"]),
      extra: extraOf(message, mapped),
      battery:
        batteryLevel === null && batteryState === null
          ? null
          : { recordedAt: time.value, level: batteryLevel, state: batteryState },
    },
  };
}
