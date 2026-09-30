import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { type CBORType, encodeCBOR } from "@levischuck/tiny-cbor";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/* Authenticator data flags (WebAuthn §6.1). */
const userPresent = 0x01;
const userVerified = 0x04;
const backupEligible = 0x08;
const backedUp = 0x10;
const attestedCredentialData = 0x40;

/** iCloud Keychain, so tests also see a provider name resolved from the AAGUID. */
const defaultAaguid = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd";

interface StoredCredential {
  id: Buffer;
  rpId: string;
  userHandle: Buffer;
  privateKey: KeyObject;
  counter: number;
}

const sha256 = (data: Buffer | string): Buffer => createHash("sha256").update(data).digest();
const uint32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const uint16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
};

/**
 * A passkey provider in software: ES256 (P-256) keys, "none" attestation, CBOR
 * attestation objects, a signature counter and synced-passkey (BE/BS) flags.
 * It produces exactly what a browser hands to @simplewebauthn/browser.
 */
export class SoftwareAuthenticator {
  readonly credentials: StoredCredential[] = [];
  readonly #aaguid: Buffer;
  readonly #synced: boolean;

  constructor(options: { aaguid?: string; synced?: boolean } = {}) {
    this.#aaguid = Buffer.from((options.aaguid ?? defaultAaguid).replaceAll("-", ""), "hex");
    this.#synced = options.synced ?? true;
  }

  #flags(base: number): number {
    return base | userPresent | userVerified | (this.#synced ? backupEligible | backedUp : 0);
  }

  /** `navigator.credentials.create()` on `origin`. */
  createCredential(
    options: PublicKeyCredentialCreationOptionsJSON,
    origin: string,
    overrides: { clientOrigin?: string; challenge?: string } = {},
  ): RegistrationResponseJSON {
    const rpId = options.rp.id ?? new URL(origin).hostname;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    if (jwk.x === undefined || jwk.y === undefined) throw new Error("EC key without coordinates");
    const coseKey = encodeCBOR(
      new Map<number, CBORType>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
      ]),
    );
    const credentialId = randomBytes(32);
    const authenticatorData = Buffer.concat([
      sha256(rpId),
      Buffer.from([this.#flags(attestedCredentialData)]),
      uint32(0),
      this.#aaguid,
      uint16(credentialId.length),
      credentialId,
      Buffer.from(coseKey),
    ]);
    const attestationObject = encodeCBOR(
      new Map<string, CBORType>([
        ["fmt", "none"],
        ["attStmt", new Map<string, CBORType>()],
        ["authData", new Uint8Array(authenticatorData)],
      ]),
    );
    const clientDataJSON = JSON.stringify({
      type: "webauthn.create",
      challenge: overrides.challenge ?? options.challenge,
      origin: overrides.clientOrigin ?? origin,
      crossOrigin: false,
    });
    this.credentials.push({
      id: credentialId,
      rpId,
      userHandle: Buffer.from(options.user.id, "base64url"),
      privateKey,
      counter: 0,
    });
    const id = credentialId.toString("base64url");
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: Buffer.from(clientDataJSON).toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal", "hybrid"],
      },
      clientExtensionResults: { credProps: { rk: true } },
      authenticatorAttachment: "platform",
    };
  }

  /**
   * `navigator.credentials.get()` on `origin`: the first allowed credential,
   * or (discoverable) the first one of the RP ID, or the one asked for.
   */
  getAssertion(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
    overrides: { credentialId?: string; clientOrigin?: string } = {},
  ): AuthenticationResponseJSON {
    const rpId = options.rpId ?? new URL(origin).hostname;
    const allowed = new Set((options.allowCredentials ?? []).map((credential) => credential.id));
    const credential = this.credentials.find((candidate) => {
      const id = candidate.id.toString("base64url");
      if (overrides.credentialId !== undefined) return id === overrides.credentialId;
      return candidate.rpId === rpId && (allowed.size === 0 || allowed.has(id));
    });
    if (credential === undefined) throw new Error(`No passkey for ${rpId}`);
    credential.counter += 1;
    const authenticatorData = Buffer.concat([
      sha256(credential.rpId),
      Buffer.from([this.#flags(0)]),
      uint32(credential.counter),
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge,
        origin: overrides.clientOrigin ?? origin,
        crossOrigin: false,
      }),
    );
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      credential.privateKey,
    );
    const id = credential.id.toString("base64url");
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
        userHandle: credential.userHandle.toString("base64url"),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
