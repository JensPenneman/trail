import { randomBytes } from "node:crypto";
import type { ApiScope } from "@trail/contracts/apiScope";
import { eq } from "drizzle-orm";
import type { TokenPrincipal } from "../../src/auth/requestAuth";
import type { Database } from "../../src/db/database";
import { users } from "../../src/db/schema/users";
import type { ApiTokenVerifier, TokenRejection } from "../../src/v1/apiTokens";

/** A secret of the right shape that no store knows. */
export const tokenSecret = (): string => `trlk_${randomBytes(32).toString("base64url")}`;

/**
 * A token store for tests: secrets it issued verify as the principal or the
 * refusal they were issued for; anything else is unknown. It records every call.
 */
export class FakeApiTokens implements ApiTokenVerifier {
  readonly calls: { secret: string; ip: string | null }[] = [];
  readonly #outcomes = new Map<string, TokenPrincipal | TokenRejection>();

  issue(outcome: TokenPrincipal | TokenRejection): string {
    const secret = tokenSecret();
    this.#outcomes.set(secret, outcome);
    return secret;
  }

  async verify(
    secret: string,
    request: { ip: string | null },
  ): Promise<TokenPrincipal | TokenRejection> {
    this.calls.push({ secret, ip: request.ip });
    return this.#outcomes.get(secret) ?? { reason: "unknown" };
  }
}

/** A token principal of the account with this address. */
export async function tokenPrincipal(
  db: Database,
  email: string,
  options: { scopes: readonly ApiScope[]; deviceIds?: readonly string[] | null },
): Promise<TokenPrincipal> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user === undefined) throw new Error(`No account ${email}`);
  return {
    kind: "token",
    user,
    tokenId: randomBytes(8).toString("hex"),
    scopes: options.scopes,
    deviceIds: options.deviceIds ?? null,
  };
}
