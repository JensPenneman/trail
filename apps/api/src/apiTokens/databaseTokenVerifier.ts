import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { TokenPrincipal } from "../auth/requestAuth";
import type { Database } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";
import { users } from "../db/schema/users";
import type { BackgroundTasks } from "../lib/backgroundTasks";
import { hashToken } from "../lib/hashToken";
import type { ApiTokenVerifier, TokenRejection } from "../v1/apiTokens";
import { addressAllowed } from "./addressAllowed";
import { clientAddress } from "./clientAddress";

/** `last_used_at` and `last_used_ip` are refreshed at most this often per token (the SQL says 1 minute too). */
const touchIntervalMs = 60_000;

/**
 * The token store behind `/api/v1` (docs/architecture.md §8.4): a secret is
 * looked up by its SHA-256, together with its user, and refused when it is
 * revoked, used from an address outside its allowlist, or expired — in that
 * order, so a caller outside the allowlist learns nothing, not even that the
 * token has expired. Recording the use happens after the answer, in the
 * background: it can neither slow down nor fail the request.
 */
export class DatabaseTokenVerifier implements ApiTokenVerifier {
  readonly #db: Database;
  readonly #background: BackgroundTasks;
  /** Tokens whose use is being recorded: a burst of requests writes once. */
  readonly #touching = new Set<string>();

  constructor(db: Database, background: BackgroundTasks) {
    this.#db = db;
    this.#background = background;
  }

  async verify(
    secret: string,
    request: { ip: string | null },
  ): Promise<TokenPrincipal | TokenRejection> {
    const [found] = await this.#db
      .select({ token: apiTokens, user: users })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(eq(apiTokens.tokenHash, hashToken(secret)))
      .limit(1);
    if (found === undefined) return { reason: "unknown" };
    const { token, user } = found;
    if (token.revokedAt !== null) return { reason: "revoked" };
    const address = clientAddress(request.ip);
    if (token.allowedIps !== null && !addressAllowed(address, token.allowedIps)) {
      return { reason: "ip" };
    }
    if (token.expiresAt !== null && token.expiresAt.getTime() <= Date.now()) {
      return { reason: "expired" };
    }
    this.#touch(token.id, token.lastUsedAt, address);
    return {
      kind: "token",
      user,
      tokenId: token.id,
      scopes: token.scopes,
      deviceIds: token.deviceIds,
    };
  }

  #touch(tokenId: string, lastUsedAt: Date | null, address: string | null): void {
    if (lastUsedAt !== null && Date.now() - lastUsedAt.getTime() < touchIntervalMs) return;
    if (this.#touching.has(tokenId)) return;
    this.#touching.add(tokenId);
    this.#background.run("record API token use", async () => {
      try {
        // The condition repeats the check in SQL: concurrent requests write the row once.
        await this.#db
          .update(apiTokens)
          .set({ lastUsedAt: sql`now()`, lastUsedIp: address })
          .where(
            and(
              eq(apiTokens.id, tokenId),
              or(
                isNull(apiTokens.lastUsedAt),
                lt(apiTokens.lastUsedAt, sql`now() - interval '1 minute'`),
              ),
            ),
          );
      } finally {
        this.#touching.delete(tokenId);
      }
    });
  }
}
