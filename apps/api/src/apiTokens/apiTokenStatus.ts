import type { ApiTokenStatus } from "@trail/contracts/apiToken";

/** Revoked beats expired: a revoked token stays revoked whatever its expiry says. */
export function apiTokenStatus(
  token: { revokedAt: Date | null; expiresAt: Date | null },
  now: number = Date.now(),
): ApiTokenStatus {
  if (token.revokedAt !== null) return "revoked";
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now) return "expired";
  return "active";
}
