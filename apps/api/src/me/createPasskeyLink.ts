import type { Executor } from "../db/database";
import { passkeyLinks } from "../db/schema/passkeyLinks";
import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";

/** Passkey links are short-lived: they are a key to the account (docs/architecture.md §7). */
const linkTtlMs = 15 * 60_000;

/**
 * One-time URL that adds a passkey to an account on `origin` — from Settings
 * ("another device or address") or from the CLI for account recovery.
 */
export async function createPasskeyLink(
  db: Executor,
  input: { userId: string; origin: string; createdBy: "cli" | "user" },
): Promise<{ url: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + linkTtlMs);
  await db.insert(passkeyLinks).values({
    tokenHash: hashToken(token),
    userId: input.userId,
    origin: input.origin,
    createdBy: input.createdBy,
    expiresAt,
  });
  return { url: `${input.origin}/link/${token}`, expiresAt };
}
