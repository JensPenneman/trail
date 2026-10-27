import { z } from "zod";
import type { DataAccessActor } from "./dataAccess";

/*
 * One actor of the data access log, as a filter of the API and an address of
 * the dashboard name it (docs/architecture.md §8.8): `person:<userId>`,
 * `token:<tokenId>`, `link:<linkId>`, or `session:<browser>` for the owner's
 * own browsers by the name the log gives them — the log keeps no session ids.
 * Made and read here only, so the API and the pages cannot disagree on it.
 */

/** Whom an actor id stands for. */
export type DataAccessActorRef =
  | { kind: "person"; userId: string }
  | { kind: "token"; tokenId: string }
  | { kind: "link"; linkId: string }
  | { kind: "session"; label: string };

/** The longest browser name the log keeps (`actor_label`). */
const maxSessionLabel = 120;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const controlCharacter = /[\u0000-\u001f\u007f]/;

/** The id of an actor: `person:<userId>`, `token:<tokenId>`, `link:<linkId>`, `session:<browser>`. */
export function dataAccessActorId(ref: DataAccessActorRef): string {
  switch (ref.kind) {
    case "person":
      return `person:${ref.userId}`;
    case "token":
      return `token:${ref.tokenId}`;
    case "link":
      return `link:${ref.linkId}`;
    case "session":
      return `session:${ref.label}`;
  }
}

/** Whom an actor id stands for, or null for anything that is not one. */
export function parseDataAccessActorId(value: string): DataAccessActorRef | null {
  const colon = value.indexOf(":");
  if (colon < 0) return null;
  const kind = value.slice(0, colon);
  const rest = value.slice(colon + 1);
  if (kind === "session") {
    return rest.length > 0 && rest.length <= maxSessionLabel && !controlCharacter.test(rest)
      ? { kind, label: rest }
      : null;
  }
  const id = rest.toLowerCase();
  if (!uuidPattern.test(id)) return null;
  switch (kind) {
    case "person":
      return { kind, userId: id };
    case "token":
      return { kind, tokenId: id };
    case "link":
      return { kind, linkId: id };
    default:
      return null;
  }
}

/** The actor of a line of the log, as an actor id: a link's visitors all count as the link. */
export function actorIdOf(actor: DataAccessActor): string {
  switch (actor.kind) {
    case "owner":
      return dataAccessActorId({ kind: "session", label: actor.sessionLabel });
    case "person":
      return dataAccessActorId({ kind: "person", userId: actor.userId });
    case "token":
      return dataAccessActorId({ kind: "token", tokenId: actor.tokenId });
    case "link":
      return dataAccessActorId({ kind: "link", linkId: actor.linkId });
  }
}

/** `actorId` of the access log's list and summary. */
export const dataAccessActorIdSchema = z
  .string()
  .max("session:".length + maxSessionLabel)
  .refine((value) => parseDataAccessActorId(value) !== null, {
    message:
      "Not an actor: person:<userId>, token:<tokenId>, link:<linkId> or session:<browser name>",
  })
  .meta({ example: "person:019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23" });
