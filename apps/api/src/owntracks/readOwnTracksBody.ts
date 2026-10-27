import { storableText } from "../ingest/storableText";
import { redactSecrets } from "../ingest/withoutSecrets";

export type OwnTracksBody =
  /** OwnTracks posts an empty body when a friend is removed: nothing to store, still acknowledged. */
  | { kind: "empty" }
  | { kind: "message"; value: unknown }
  /** Not JSON: kept for the dead letter as a preview, never parsed further. */
  | { kind: "unreadable"; preview: string };

/** What the raw body parser left: a Buffer, or nothing for a request without a body. */
export function readOwnTracksBody(body: unknown): OwnTracksBody {
  if (!Buffer.isBuffer(body)) return { kind: "empty" };
  const text = body.toString("utf8").replace(/^﻿/, "");
  if (text.trim() === "") return { kind: "empty" };
  try {
    return { kind: "message", value: JSON.parse(text) as unknown };
  } catch {
    // Redacted whole, then cut: a token cut in half would no longer be recognised.
    return { kind: "unreadable", preview: storableText(redactSecrets(text).slice(0, 2000)) };
  }
}
