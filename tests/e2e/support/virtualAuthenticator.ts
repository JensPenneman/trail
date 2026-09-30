import type { CDPSession, Page } from "@playwright/test";

/** A passkey as the DevTools protocol reports it (`WebAuthn.Credential`, the fields used here). */
export interface VirtualPasskey {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  /** ECDSA P-256 private key, PKCS#8, base64. */
  privateKey: string;
  userHandle?: string;
  signCount: number;
}

type Transport = "internal" | "usb";

/**
 * A passkey provider in Chromium, driven through the DevTools protocol: CTAP 2.1
 * with resident keys, user verification that succeeds and user presence
 * simulated automatically. The "internal" transport stands for the platform
 * authenticator (Touch ID, Windows Hello; Chromium allows one per page), "usb"
 * for a security key.
 */
export class VirtualAuthenticator {
  readonly #session: CDPSession;
  readonly #id: string;

  private constructor(session: CDPSession, id: string) {
    this.#session = session;
    this.#id = id;
  }

  /** The platform authenticator of `page` (enables the virtual WebAuthn environment). */
  static async attach(page: Page): Promise<VirtualAuthenticator> {
    const session = await page.context().newCDPSession(page);
    await session.send("WebAuthn.enable", { enableUI: false });
    return VirtualAuthenticator.#add(session, "internal");
  }

  static async #add(session: CDPSession, transport: Transport): Promise<VirtualAuthenticator> {
    const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        transport,
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    return new VirtualAuthenticator(session, authenticatorId);
  }

  /** A second authenticator on the same page: a USB security key. */
  addSecurityKey(): Promise<VirtualAuthenticator> {
    return VirtualAuthenticator.#add(this.#session, "usb");
  }

  async passkeys(): Promise<VirtualPasskey[]> {
    const { credentials } = await this.#session.send("WebAuthn.getCredentials", {
      authenticatorId: this.#id,
    });
    return credentials;
  }

  /** Stores a passkey exported from another authenticator (the same person on a second browser). */
  async importPasskey(passkey: VirtualPasskey): Promise<void> {
    await this.#session.send("WebAuthn.addCredential", {
      authenticatorId: this.#id,
      credential: passkey,
    });
  }

  /**
   * With presence off the authenticator never answers — as if nobody touched it —
   * so another authenticator of the page takes the ceremony.
   */
  async setPresence(present: boolean): Promise<void> {
    await this.#session.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId: this.#id,
      enabled: present,
    });
  }
}
