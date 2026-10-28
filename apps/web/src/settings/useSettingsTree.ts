import type { DeviceSummary } from "@trail/contracts/device";
import { deviceAppInfo } from "@trail/contracts/deviceApp";
import { useMemo } from "react";
import { useSessionUser } from "../app/useSessionUser";
import { useFormatter } from "../format/useFormatter";
import { useAccessSummary } from "../queries/useAccessSummary";
import { useApiTokens } from "../queries/useApiTokens";
import { useConfig } from "../queries/useConfig";
import { useDevices } from "../queries/useDevices";
import { usePasskeys } from "../queries/usePasskeys";
import { useSessions } from "../queries/useSessions";
import { useShareLinks } from "../queries/useShareLinks";
import { useShares } from "../queries/useShares";
import { useNow } from "../time/useNow";
import { type SettingsBadgeSources, settingsBadgeValue } from "./settingsBadges";
import {
  type SettingsSearchEntry,
  type SettingsSearchItem,
  searchSettings,
  settingsSearchIndex,
} from "./settingsSearchIndex";
import { type SettingsGroupInfo, type SettingsNode, settingsGroupsFor } from "./settingsTree";

interface SettingsTreeRow {
  node: SettingsNode;
  /** What the row shows on its right; null for nothing. */
  value: string | null;
}

export interface SettingsTree {
  groups: readonly { group: SettingsGroupInfo; rows: readonly SettingsTreeRow[] }[];
  search: (query: string) => SettingsSearchEntry[];
}

/** A device as search finds it: by its name, its app and its device ID. */
const searchItemOf = (device: DeviceSummary): SettingsSearchItem => ({
  id: device.id,
  label: device.name,
  keywords: [deviceAppInfo[device.source].name, device.deviceKey],
});

/**
 * The tree as the signed-in person sees it: administrators' rows only for
 * administrators, each row with its value, and search that also finds one's
 * devices by name. The values come from the lists the pages show themselves
 * (one cache), so opening a page after the list asks for nothing again.
 */
export function useSettingsTree(): SettingsTree {
  const user = useSessionUser();
  const format = useFormatter();
  const now = useNow(60_000);
  const devices = useDevices().data;
  const sources: SettingsBadgeSources = {
    user,
    now,
    count: format.count,
    passkeys: usePasskeys().data,
    sessions: useSessions().data,
    shares: useShares().data,
    links: useShareLinks().data,
    tokens: useApiTokens().data,
    devices,
    config: useConfig().data,
    viewers: useAccessSummary({ days: 30, actorId: null }).data,
  };
  const index = useMemo(
    () => settingsSearchIndex(user.isAdmin, { device: (devices ?? []).map(searchItemOf) }),
    [user.isAdmin, devices],
  );
  return {
    groups: settingsGroupsFor(user.isAdmin).map(({ group, nodes }) => ({
      group,
      rows: nodes.map((node) => ({
        node,
        value: node.badge === undefined ? null : settingsBadgeValue(node.badge, sources),
      })),
    })),
    search: (query) => searchSettings(index, query),
  };
}
