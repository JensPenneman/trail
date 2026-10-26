import { apiTokenSecretPattern } from "@trail/contracts/apiToken";
import type { TokenPrincipal } from "../auth/requestAuth";

/** An API token secret: `trlk_` and 32 random bytes in base64url (the contract's pattern). */
export const apiTokenPattern = apiTokenSecretPattern;

/**
 * Why a token was refused. The client only learns about `expired` (401
 * `token_expired`, so it knows to get a new one); everything else is the same
 * 401 `unauthorized`, which tells nobody whether a token exists.
 */
export interface TokenRejection {
  reason: "unknown" | "expired" | "revoked" | "ip";
}

/**
 * The seam between `/api/v1` and the token store: resolves a token secret to
 * the principal it stands for. `authenticateBearer` has checked the shape
 * (`apiTokenPattern`) before `verify` sees a secret. A refused token is an
 * answer, not an exception (a throw is a server error), and a secret is never
 * logged. `ip` is the client address as `trust proxy` sees it, for allowlists.
 */
export interface ApiTokenVerifier {
  verify(secret: string, request: { ip: string | null }): Promise<TokenPrincipal | TokenRejection>;
}
