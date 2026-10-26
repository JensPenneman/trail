import { shareLinkSecretPattern } from "@trail/contracts/shareLink";
import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";

/** A new link secret (`trls_` + 32 random bytes) and the hash that is stored instead of it. */
export function newShareLinkSecret(): { secret: string; hash: string } {
  const secret = `trls_${randomToken()}`;
  return { secret, hash: hashToken(secret) };
}

/** Only a value of the right shape is ever looked up. */
export const isShareLinkSecret = (value: string): boolean => shareLinkSecretPattern.test(value);
