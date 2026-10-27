import { deadLetterRecord } from "../ingest/deadLetterRecord";
import { asRecord } from "../ingest/ingestValues";
import { emptyBatch, type PreparedBatch } from "../ingest/preparedBatch";
import { withoutSecrets } from "../ingest/withoutSecrets";
import { normaliseOwnTracksEvent } from "./normaliseOwnTracksEvent";
import { normaliseOwnTracksLocation } from "./normaliseOwnTracksLocation";
import type { OwnTracksBody } from "./readOwnTracksBody";

/*
 * Message types Trail acknowledges and leaves alone: what the apps publish
 * besides positions — regions (`waypoint`, `waypoints`), app status, commands,
 * cards, beacons, step counts — and the configuration in `dump` and
 * `configuration`, which holds the password, Trail's device token: never stored.
 */
const ignoredTypes = new Set([
  "waypoint",
  "waypoints",
  "status",
  "cmd",
  "card",
  "beacon",
  "steps",
  "dump",
  "configuration",
  "request",
  "clear",
]);

/** An OwnTracks upload prepared for storing, and the message as the dead letter would keep it. */
export interface PreparedOwnTracks {
  batch: PreparedBatch;
  record: unknown;
}

const rejectedAs = (reason: string, record: unknown): PreparedOwnTracks => {
  const kept = deadLetterRecord(withoutSecrets(record));
  return { batch: { ...emptyBatch(1), rejects: [{ reason, record: kept }] }, record: kept };
};

/**
 * One OwnTracks HTTP request — a single JSON message with `_type`
 * (docs/architecture.md §6.5) — as a batch of at most one record. The message
 * loses its credentials before anything reads it (`withoutSecrets`): no token
 * reaches a column — a Wi-Fi name, a motion activity, a region's name in an
 * event's action — `extra` or the dead letter. Whatever cannot be read is
 * kept in the dead letter and still acknowledged: Android retries an
 * unacknowledged message for weeks, ahead of everything queued after it.
 */
export function prepareOwnTracks(body: OwnTracksBody, receivedAt: Date): PreparedOwnTracks {
  if (body.kind === "empty") return { batch: emptyBatch(0), record: null };
  if (body.kind === "unreadable") return rejectedAs("body is not JSON", { body: body.preview });
  const scrubbed = withoutSecrets(body.value);
  const message = asRecord(scrubbed);
  if (message === null) return rejectedAs("message is not a JSON object", scrubbed);
  const type = message["_type"];
  if (typeof type !== "string") return rejectedAs("message without _type", message);
  if (ignoredTypes.has(type)) return { batch: emptyBatch(1), record: null };

  switch (type) {
    case "location": {
      const result = normaliseOwnTracksLocation(message, receivedAt);
      if (!result.ok) return rejectedAs(result.reason, message);
      const location = result.value;
      return {
        batch: {
          ...emptyBatch(1),
          locationRecords: 1,
          locations: [location],
          battery: location.battery,
        },
        record: message,
      };
    }
    case "transition":
    case "lwt": {
      const result = normaliseOwnTracksEvent(message, receivedAt);
      if (!result.ok) return rejectedAs(result.reason, message);
      return {
        batch: { ...emptyBatch(1), events: [result.value] },
        record: message,
      };
    }
    case "encrypted":
      // The key stays on the phone: Trail cannot read these, a later fix might.
      return rejectedAs("encrypted message: turn off encryption in OwnTracks", message);
    default:
      return rejectedAs(`unknown _type ${JSON.stringify(type.slice(0, 40))}`, message);
  }
}
