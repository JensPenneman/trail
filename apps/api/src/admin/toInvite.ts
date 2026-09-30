import type { Invite } from "@trail/contracts/invite";
import type { InviteRow } from "../auth/findValidInvite";

/** Contract shape of an invite (never includes the token). */
export function toInvite(row: InviteRow, usedByEmail: string | null): Invite {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    usedByEmail,
  };
}
