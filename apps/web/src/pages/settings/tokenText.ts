import type { ApiToken } from "@trail/contracts/apiToken";
import type { Formatter } from "../../format/createFormatter";

export const tokenStatusLabels: Readonly<Record<ApiToken["status"], string>> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

/** A token as the clock sees it: one that expired while the page was open reads as expired. */
export function tokenAsOf(token: ApiToken, now: number): ApiToken {
  return token.status === "active" && token.expiresAt !== null && Date.parse(token.expiresAt) <= now
    ? { ...token, status: "expired" }
    : token;
}

/** "All devices", "No devices", or the names of the devices a limited token reaches. */
export function tokenDevicesText(
  token: ApiToken,
  deviceNames: ReadonlyMap<string, string>,
  format: Formatter,
): string {
  if (token.deviceIds === null) return "All devices";
  if (token.deviceIds.length === 0) return "No devices";
  return format.list(token.deviceIds.map((id) => deviceNames.get(id) ?? "a device"));
}

/** "Never expires", "Expires 12 Nov 2026, 09:41", "Revoked …". */
export function tokenLifetimeText(token: ApiToken, format: Formatter): string {
  if (token.status === "revoked")
    return `Revoked ${format.dateTime(token.revokedAt ?? token.createdAt)}`;
  if (token.expiresAt === null) return "Never expires";
  return `${token.status === "expired" ? "Expired" : "Expires"} ${format.dateTime(token.expiresAt)}`;
}

/** "Never used", "Last used 5 min ago from 192.168.1.20". */
export function tokenLastUseText(token: ApiToken, format: Formatter, now: number): string {
  if (token.lastUsedAt === null) return "Never used";
  const from = token.lastUsedIp === null ? "" : ` from ${token.lastUsedIp}`;
  return `Last used ${format.relative(token.lastUsedAt, now)}${from}`;
}
