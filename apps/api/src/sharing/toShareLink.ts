import type { ShareLink } from "@trail/contracts/shareLink";
import type { shareLinks } from "../db/schema/shareLinks";

export type ShareLinkRow = typeof shareLinks.$inferSelect;

/** A link as its owner sees it: never with the secret, which only its hash stands for. */
export function toShareLink(row: ShareLinkRow, now = new Date()): ShareLink {
  return {
    id: row.id,
    label: row.label,
    deviceIds: row.deviceIds,
    precision: row.precision,
    historyDays: row.historyDays,
    includeDetails: row.includeDetails,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    status: row.expiresAt.getTime() <= now.getTime() ? "expired" : "active",
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
  };
}
