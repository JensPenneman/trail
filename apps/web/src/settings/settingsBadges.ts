import type { ApiToken } from "@trail/contracts/apiToken";
import type { PublicConfig } from "@trail/contracts/config";
import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Passkey } from "@trail/contracts/passkey";
import type { SessionInfo } from "@trail/contracts/session";
import type { OutgoingShare } from "@trail/contracts/share";
import type { ShareLink } from "@trail/contracts/shareLink";
import type { SessionUser } from "@trail/contracts/user";
import type { SettingsBadgeId } from "./settingsTree";

/** What the badges are made of: the session, and the lists that have loaded so far. */
export interface SettingsBadgeSources {
  user: SessionUser;
  now: number;
  count: (value: number) => string;
  passkeys?: readonly Passkey[] | undefined;
  sessions?: readonly SessionInfo[] | undefined;
  shares?: readonly OutgoingShare[] | undefined;
  links?: readonly ShareLink[] | undefined;
  tokens?: readonly ApiToken[] | undefined;
  devices?: readonly DeviceSummary[] | undefined;
  config?: PublicConfig | undefined;
  /** Who looked in the last 30 days (the Who viewed you page's default period). */
  viewers?: DataAccessSummary | undefined;
}

const working = (token: ApiToken, now: number): boolean =>
  token.status === "active" && (token.expiresAt === null || Date.parse(token.expiresAt) > now);

/**
 * The value on the right of a row: a count of what the page lists ("2", "3
 * active"), a state ("Off") or a name. Null while it has not loaded, and
 * where there is nothing to count, so an empty list does not read as "0".
 */
export function settingsBadgeValue(
  id: SettingsBadgeId,
  sources: SettingsBadgeSources,
): string | null {
  const { count } = sources;
  const counted = (items: readonly unknown[] | undefined) =>
    items === undefined || items.length === 0 ? null : count(items.length);
  switch (id) {
    case "profile":
      return sources.user.displayName;
    case "devices":
      return counted(sources.devices);
    case "passkeys":
      return counted(sources.passkeys);
    case "browsers":
      return counted(sources.sessions);
    case "sharing":
      return counted(sources.shares);
    case "links": {
      const active = (sources.links ?? []).filter((link) => link.status === "active").length;
      return active === 0 ? null : `${count(active)} active`;
    }
    case "viewers": {
      if (sources.viewers === undefined) return null;
      const { people, links, tokens } = sources.viewers;
      const viewers = people.length + links.length + tokens.length;
      return viewers === 0 ? null : count(viewers);
    }
    case "tokens":
      return counted(sources.tokens?.filter((token) => working(token, sources.now)));
    case "notifications": {
      if (sources.config === undefined) return null;
      if (!sources.config.features.alerts) return "Off";
      if (sources.devices === undefined) return null;
      return sources.devices.some((device) => device.alertsEnabled) ? "On" : "Off";
    }
    case "about":
      return sources.config?.version ?? null;
  }
}
