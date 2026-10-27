import { useMemo } from "react";
import { useApiTokens } from "../queries/useApiTokens";
import { useDevices } from "../queries/useDevices";
import { useShareLinks } from "../queries/useShareLinks";
import { useShares } from "../queries/useShares";
import { recipientName } from "../sharing/recipientName";
import type { ResourceNames } from "./resourceFacts";

/**
 * The names of what the log's lines name by id — devices, shares, links,
 * tokens — from the lists Settings has loaded anyway (one cache): null until
 * a list has come, and what is gone from one shows as gone.
 */
export function useResourceNames(): ResourceNames {
  const devices = useDevices().data;
  const shares = useShares().data;
  const links = useShareLinks().data;
  const tokens = useApiTokens().data;
  return useMemo(
    () => ({
      devices:
        devices === undefined ? null : new Map(devices.map((device) => [device.id, device.name])),
      shares:
        shares === undefined
          ? null
          : new Map(shares.map((share) => [share.id, recipientName(share)])),
      links: links === undefined ? null : new Map(links.map((link) => [link.id, link.label])),
      tokens: tokens === undefined ? null : new Map(tokens.map((token) => [token.id, token.name])),
    }),
    [devices, shares, links, tokens],
  );
}
