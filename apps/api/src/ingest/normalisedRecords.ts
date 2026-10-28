import type { BatteryReading } from "./batteryReading";
import type { BatteryState } from "./ingestValues";

/*
 * The records an upload is stored as, whichever app sent it: every protocol's
 * normaliser produces these, and the inserts take nothing else.
 */

/** A location point: a row of `locations`. */
export interface NormalisedLocation {
  recordedAt: Date;
  lat: number;
  lon: number;
  altitude: number | null;
  /** Metres per second, whatever the app sent. */
  speed: number | null;
  course: number | null;
  horizontalAccuracy: number | null;
  verticalAccuracy: number | null;
  speedAccuracy: number | null;
  courseAccuracy: number | null;
  /** Motion activity in CoreMotion's words (`walking`, `automotive` …). */
  motion: string[];
  /** 0..1 */
  batteryLevel: number | null;
  batteryState: BatteryState | null;
  /** The Wi-Fi network's name. */
  wifi: string | null;
  /** Everything the app sent that has no column, so nothing is lost. */
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}

/** A place where iOS saw the phone stay (Overland's visits). */
export interface NormalisedVisit {
  recordedAt: Date;
  arrivedAt: Date | null;
  departedAt: Date | null;
  lat: number;
  lon: number;
  horizontalAccuracy: number | null;
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}

/** A finished trip of Overland's trip recorder. */
export interface NormalisedTrip {
  startedAt: Date;
  endedAt: Date;
  mode: string;
  distanceM: number | null;
  durationS: number | null;
  steps: number | null;
  stoppedAutomatically: boolean;
  startLocation: unknown;
  endLocation: unknown;
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}

/** Something the app reported that is no point: a log action, a region transition, a heartbeat. */
export interface NormalisedEvent {
  recordedAt: Date;
  /** Part of the table's key, at most 100 characters. */
  action: string;
  lat: number | null;
  lon: number | null;
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}
