import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";

export interface ApiTokenSecret {
  /** Shown exactly once: when the token is created or rolled. */
  secret: string;
  hash: string;
  /** Last four characters, to tell tokens apart in the list. */
  hint: string;
}

/** A new API token secret: `trlk_` + 32 random bytes base64url; only its SHA-256 is stored. */
export function generateApiTokenSecret(): ApiTokenSecret {
  const secret = `trlk_${randomToken(32)}`;
  return { secret, hash: hashToken(secret), hint: secret.slice(-4) };
}
