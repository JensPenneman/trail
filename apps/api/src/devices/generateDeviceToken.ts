import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";

export interface DeviceToken {
  /** Shown to the user exactly once (create / rotate). */
  token: string;
  hash: string;
  /** Last four characters, to tell tokens apart in the UI. */
  hint: string;
}

/** A new Overland access token: `trl_` + 32 random bytes base64url; only its SHA-256 is stored. */
export function generateDeviceToken(): DeviceToken {
  const token = `trl_${randomToken(32)}`;
  return { token, hash: hashToken(token), hint: token.slice(-4) };
}
