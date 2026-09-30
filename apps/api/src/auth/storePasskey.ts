import type { Executor } from "../db/database";
import { isUniqueViolation } from "../db/isUniqueViolation";
import { passkeys } from "../db/schema/passkeys";
import { HttpError } from "../http/httpError";
import { providerForAaguid } from "./providerForAaguid";
import type { VerifiedRegistration } from "./verifyRegistration";

export type PasskeyRow = typeof passkeys.$inferSelect;

/** Saves a verified passkey; its default name is the provider (e.g. "iCloud Keychain"). */
export async function storePasskey(
  db: Executor,
  input: { userId: string; rpId: string; registration: VerifiedRegistration; name?: string },
): Promise<PasskeyRow> {
  const { credential } = input.registration;
  try {
    const [row] = await db
      .insert(passkeys)
      .values({
        id: credential.id,
        userId: input.userId,
        rpId: input.rpId,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: (credential.transports ?? []).filter((item) => typeof item === "string"),
        deviceType: input.registration.credentialDeviceType,
        backedUp: input.registration.credentialBackedUp,
        aaguid: input.registration.aaguid,
        name: input.name ?? providerForAaguid(input.registration.aaguid) ?? "Passkey",
      })
      .returning();
    if (row === undefined) throw new Error("Storing the passkey returned no row");
    return row;
  } catch (error) {
    if (isUniqueViolation(error, "passkeys_pkey")) {
      throw new HttpError(409, "conflict", "This passkey is already registered.");
    }
    throw error;
  }
}
