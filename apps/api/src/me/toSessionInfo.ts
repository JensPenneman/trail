import type { SessionInfo } from "@trail/contracts/session";
import { userAgentLabel } from "../auth/userAgentLabel";
import type { sessions } from "../db/schema/sessions";

export type SessionRow = typeof sessions.$inferSelect;

export function toSessionInfo(row: SessionRow, currentSessionId: string): SessionInfo {
  return {
    id: row.id,
    current: row.id === currentSessionId,
    label: userAgentLabel(row.userAgent),
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
