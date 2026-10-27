import { dataAccessActorId, parseDataAccessActorId } from "@trail/contracts/dataAccessActorId";

/*
 * The page of one actor, Settings › Who viewed you › …, names the actor in
 * its address: the actor id (`person:<userId>`, `session:Safari on iPhone`)
 * as base64url, so a browser's name needs no escaping and the segment is one
 * opaque token that only these two functions make and read.
 */

const base64url = /^[A-Za-z0-9_-]+$/;

/** An actor id as one segment of an address. */
export function actorSegment(actorId: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(actorId)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The actor id a segment stands for, written as `dataAccessActorId` writes it; null for any other segment. */
export function actorIdOfSegment(segment: string): string | null {
  if (!base64url.test(segment)) return null;
  try {
    const padded = `${segment.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (segment.length % 4)) % 4)}`;
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const ref = parseDataAccessActorId(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return ref === null ? null : dataAccessActorId(ref);
  } catch {
    // Not base64, or not UTF-8.
    return null;
  }
}

/** Settings › Who viewed you › the actor. */
export const viewerPath = (actorId: string): string =>
  `/settings/privacy/viewers/${actorSegment(actorId)}`;
