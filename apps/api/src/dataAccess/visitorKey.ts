import { createHmac } from "node:crypto";

/** The `server_secrets` entry that keys the visitor keys. */
export const visitorSecretName = "data-access-visitor";

/**
 * The key a link's owner sees for a visitor: an HMAC-SHA256 under a key only
 * the server holds, of the owner and of what the log keeps of the visitor —
 * the network (/24 or /48) and the kind of browser — cut to 64 bits. The same
 * visitor gets the same key on all of the owner's links; another owner gets
 * another key; and as it is made of the coarse values alone, even someone
 * holding the server's key could learn no more than the row already says.
 */
export function visitorKey(
  secret: Buffer,
  ownerUserId: string,
  visitor: { ipCoarse: string | null; uaFamily: string },
): string {
  return createHmac("sha256", secret)
    .update(`${ownerUserId}\n${visitor.ipCoarse ?? ""}\n${visitor.uaFamily}`)
    .digest("hex")
    .slice(0, 16);
}
