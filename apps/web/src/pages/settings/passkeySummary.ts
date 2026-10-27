import type { Passkey } from "@trail/contracts/passkey";

/** "iCloud Keychain · synced · works on this address": where a passkey lives and works. */
export function passkeySummary(passkey: Passkey): string {
  return [
    passkey.provider ?? "Unknown provider",
    passkey.backedUp ? "synced" : "on one device",
    passkey.usableHere ? "works on this address" : `for ${passkey.rpId}`,
  ].join(" · ");
}
