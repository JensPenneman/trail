import type { AppContext } from "../appContext";
import { type CeremonyRow, ceremonyExpired } from "./ceremonies";
import { type PasskeyRow, storePasskey } from "./storePasskey";
import { verifyRegistration } from "./verifyRegistration";

/** Completes an `add_passkey` ceremony of the signed-in user (Settings → Add a passkey). */
export async function finishAddPasskey(
  ctx: AppContext,
  ceremony: CeremonyRow,
  input: { userId: string; response: unknown; name?: string | undefined },
): Promise<PasskeyRow> {
  // Someone else's ceremony looks exactly like an expired one.
  if (ceremony.kind !== "add_passkey" || ceremony.userId !== input.userId) throw ceremonyExpired();
  const registration = await verifyRegistration(ceremony, input.response, ctx.logger);
  return storePasskey(ctx.db, {
    userId: input.userId,
    rpId: ceremony.rpId,
    registration,
    ...(input.name === undefined ? {} : { name: input.name }),
  });
}
