import type { Passkey } from "@trail/contracts/passkey";
import { providerForAaguid } from "./providerForAaguid";
import type { PasskeyRow } from "./storePasskey";

/** Contract shape of a passkey; `usableHere` compares its RP ID with the requesting page's. */
export function toPasskey(row: PasskeyRow, currentRpId: string): Passkey {
  return {
    id: row.id,
    name: row.name,
    rpId: row.rpId,
    usableHere: row.rpId === currentRpId,
    provider: providerForAaguid(row.aaguid),
    backedUp: row.backedUp,
    deviceType: row.deviceType,
    transports: row.transports,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
