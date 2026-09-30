import type { TrackPoint } from "@trail/contracts/track";
import type { AppContext } from "../appContext";
import { publishDeviceLater } from "../devices/publishDevice";
import { recoveredDeviceAlert } from "../jobs/alertMessages";
import { localDate } from "../lib/localDate";
import type { IngestDevice } from "./ingestDevice";
import type { IngestOutcome } from "./ingestUpload";

/** The live `ingest` event carries at most this many of the new points. */
const maxLivePoints = 500;

const toTrackPoint = (point: IngestOutcome["inserted"][number]): TrackPoint => [
  point.lon,
  point.lat,
  Math.floor(point.recordedAt.getTime() / 1000),
  point.speed,
  point.accuracy,
  point.altitude,
];

/**
 * Step 5 of docs/architecture.md §6.2, after the commit and the response: live
 * events for the owner's dashboards, the debounced daily-stats refresh for the
 * touched days, and the recovery alert when the device had been reported silent.
 */
export function afterIngest(ctx: AppContext, device: IngestDevice, outcome: IngestOutcome): void {
  const { counts, inserted } = outcome;
  ctx.bus.publish(device.userId, {
    type: "ingest",
    deviceId: device.id,
    receivedAt: outcome.receivedAt.toISOString(),
    inserted: counts.locations,
    duplicates: counts.duplicates,
    rejected: counts.rejected,
    points: inserted.slice(-maxLivePoints).map(toTrackPoint),
  });
  publishDeviceLater(ctx, device.userId, device.id);

  if (inserted.length > 0) {
    const days = new Set(inserted.map((point) => localDate(point.recordedAt, device.timezone)));
    ctx.dailyStats.schedule(device.id, [...days]);
  }

  const { alerts } = ctx;
  if (outcome.wasSilent && alerts !== null) {
    ctx.background.run("recovered device alert", () => alerts(recoveredDeviceAlert(device)));
  }
}
