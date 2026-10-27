import { checkCoordinates } from "../ingest/checkCoordinates";
import { extraOf, finiteOrNull, textOrNull } from "../ingest/ingestValues";
import { type Normalised, rejected } from "../ingest/normalised";
import type { NormalisedEvent } from "../ingest/normalisedRecords";
import { checkRecordTime } from "../ingest/recordTime";
import { storableText } from "../ingest/storableText";
import { epochSecondsOf } from "./owntracksValues";

/* The action is part of the table's key, whose index cannot hold long values. */
const maxActionLength = 100;

/** The event's action: `lwt`, or `region_enter` / `region_leave` and the region's id or name. */
function actionOf(message: Record<string, unknown>): string | null {
  if (message["_type"] === "lwt") return "lwt";
  const event = message["event"];
  if (event !== "enter" && event !== "leave") return null;
  // Two regions can be entered in the same second; the key keeps both.
  const region = textOrNull(message["rid"]) ?? textOrNull(message["desc"]);
  const action = region === null ? `region_${event}` : `region_${event}:${region}`;
  // Made storable again after the cut, which may split an emoji's surrogate pair.
  return storableText(action.slice(0, maxActionLength));
}

/**
 * An OwnTracks `transition` (a region entered or left, at `tst`) or `lwt`
 * message as a device event. A transition's position is optional; one that is
 * unusable stays in `extra` with the rest of the message. The message comes
 * without its secrets (`prepareOwnTracks`): a region's name is part of the action.
 */
export function normaliseOwnTracksEvent(
  message: Record<string, unknown>,
  receivedAt: Date,
): Normalised<NormalisedEvent> {
  const action = actionOf(message);
  if (action === null) return rejected("transition without enter or leave");
  if (message["tst"] === undefined || message["tst"] === null) return rejected("missing tst");
  const at = epochSecondsOf(message["tst"]);
  if (at === null) return rejected("invalid tst");
  const time = checkRecordTime(at, receivedAt);
  if (!time.ok) return rejected(time.reason);

  const coordinates = checkCoordinates(finiteOrNull(message["lat"]), finiteOrNull(message["lon"]));
  const mapped = new Set(coordinates.ok ? ["_type", "tst", "lat", "lon"] : ["_type", "tst"]);
  return {
    ok: true,
    value: {
      recordedAt: time.value,
      action,
      lat: coordinates.ok ? coordinates.lat : null,
      lon: coordinates.ok ? coordinates.lon : null,
      extra: extraOf(message, mapped),
      battery: null,
    },
  };
}
