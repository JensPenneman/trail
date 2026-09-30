import { eq } from "drizzle-orm";
import type { Executor } from "../db/database";
import { authCeremonies, type CeremonyKind } from "../db/schema/authCeremonies";
import { HttpError } from "../http/httpError";
import { ceremonyTtlMs } from "./webauthnSettings";

export type CeremonyRow = typeof authCeremonies.$inferSelect;

export interface NewCeremony {
  kind: CeremonyKind;
  challenge: string;
  rpId: string;
  origin: string;
  email?: string;
  webauthnUserId?: Buffer;
  userId?: string;
  inviteId?: string;
  linkId?: string;
}

/** Stores a pending challenge; the returned id is the `ceremonyId` given to the browser. */
export async function createCeremony(db: Executor, ceremony: NewCeremony): Promise<string> {
  const [row] = await db
    .insert(authCeremonies)
    .values({ ...ceremony, expiresAt: new Date(Date.now() + ceremonyTtlMs) })
    .returning({ id: authCeremonies.id });
  if (row === undefined) throw new Error("Storing the ceremony returned no row");
  return row.id;
}

export const ceremonyExpired = (): HttpError =>
  new HttpError(400, "ceremony_expired", "This attempt expired. Please try again.");

/**
 * Takes a ceremony out of the store: it is deleted whether or not the response
 * verifies, so a challenge can never be answered twice.
 */
export async function consumeCeremony(db: Executor, id: string): Promise<CeremonyRow> {
  const [row] = await db.delete(authCeremonies).where(eq(authCeremonies.id, id)).returning();
  if (row === undefined || row.expiresAt.getTime() <= Date.now()) throw ceremonyExpired();
  return row;
}
