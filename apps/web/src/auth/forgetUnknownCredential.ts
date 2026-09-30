import { sendSignal } from "@simplewebauthn/browser";

/**
 * The server no longer knows this passkey (it was deleted). Telling the
 * password manager through the WebAuthn Signal API lets it stop offering the
 * dead passkey. Browsers without the API simply keep it; nothing else to do.
 */
export async function forgetUnknownCredential(credentialId: string): Promise<void> {
  try {
    await sendSignal({
      signalName: "unknownCredential",
      rpID: window.location.hostname,
      credentialID: credentialId,
    });
  } catch {
    // Unsupported or refused: the signal is best effort by design.
  }
}
