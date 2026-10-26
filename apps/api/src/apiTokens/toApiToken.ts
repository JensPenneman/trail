import type { ApiToken } from "@trail/contracts/apiToken";
import type { apiTokens } from "../db/schema/apiTokens";
import { apiTokenStatus } from "./apiTokenStatus";

export type ApiTokenRow = typeof apiTokens.$inferSelect;

const isoOrNull = (date: Date | null): string | null => date?.toISOString() ?? null;

/** A stored token as Settings shows it: everything but the hash of its secret. */
export function toApiToken(row: ApiTokenRow, now: number = Date.now()): ApiToken {
  return {
    id: row.id,
    name: row.name,
    hint: row.tokenHint,
    scopes: row.scopes,
    deviceIds: row.deviceIds,
    allowedIps: row.allowedIps,
    expiresAt: isoOrNull(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: isoOrNull(row.lastUsedAt),
    lastUsedIp: row.lastUsedIp,
    revokedAt: isoOrNull(row.revokedAt),
    status: apiTokenStatus(row, now),
  };
}
