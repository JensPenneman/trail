import { apiScopeDescriptions } from "@trail/contracts/apiScope";
import { type ApiToken, type ApiTokenTemplate, templateOfScopes } from "@trail/contracts/apiToken";
import { useState } from "react";
import { useParams } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { useApiTokens } from "../../queries/useApiTokens";
import { useDevices } from "../../queries/useDevices";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsFact, SettingsRow } from "../../settings/SettingsRow";
import { useNow } from "../../time/useNow";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { MissingItem } from "./MissingItem";
import { RevokeApiTokenDialog } from "./RevokeApiTokenDialog";
import { RollApiTokenDialog } from "./RollApiTokenDialog";
import {
  tokenAsOf,
  tokenDevicesText,
  tokenLastUseText,
  tokenLifetimeText,
  tokenStatusLabels,
} from "./tokenText";

const templateLabels: Readonly<Record<ApiTokenTemplate, string>> = {
  "read-only": "Read-only",
  agent: "Agent",
  full: "Full access",
};

/**
 * Settings › API tokens › one token: what it may do and where, until when,
 * when it was last used; a new secret (roll) or the end of it (revoke).
 */
export function ApiTokenPage() {
  const { tokenId } = useParams();
  const format = useFormatter();
  const now = useNow(60_000);
  const tokens = useApiTokens();
  const devices = useDevices();
  const [rolling, setRolling] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const found = tokens.data?.find((candidate) => candidate.id === tokenId);

  if (tokens.isPending || tokens.isError) {
    return (
      <SettingsPage parent="tokens" title="API token">
        {tokens.isPending ? (
          <LoadingBlock label="Loading the token">
            <Skeleton height="14rem" />
          </LoadingBlock>
        ) : (
          <ErrorState
            title="The token could not be loaded"
            error={tokens.error}
            onRetry={() => void tokens.refetch()}
          />
        )}
      </SettingsPage>
    );
  }
  if (found === undefined) return <MissingItem parent="tokens" item="API token" />;

  const token = tokenAsOf(found, now);
  const deviceNames = new Map((devices.data ?? []).map((device) => [device.id, device.name]));
  const template = templateOfScopes(token.scopes);
  return (
    <SettingsPage parent="tokens" title={token.name}>
      <SettingsGroup variant="facts">
        <SettingsFact label="Status">{tokenStatusLabels[token.status]}</SettingsFact>
        <SettingsFact label="Secret">
          <span className="mono">trlk_…{token.hint}</span>
        </SettingsFact>
        <SettingsFact label="Permissions">
          {template === null ? "A selection of your own" : templateLabels[template]}
        </SettingsFact>
        <SettingsFact label="Devices">{tokenDevicesText(token, deviceNames, format)}</SettingsFact>
        <SettingsFact label="Addresses">
          {token.allowedIps === null ? "Any" : format.list(token.allowedIps)}
        </SettingsFact>
        <SettingsFact label="Lifetime">{tokenLifetimeText(token, format)}</SettingsFact>
        <SettingsFact label="Use">{tokenLastUseText(token, format, now)}</SettingsFact>
        <SettingsFact label="Created">{format.dateTime(token.createdAt)}</SettingsFact>
      </SettingsGroup>
      <SettingsGroup title="Scopes">
        {token.scopes.map((scope) => (
          <SettingsRow
            key={scope}
            kind="plain"
            label={scope}
            detail={apiScopeDescriptions[scope]}
          />
        ))}
      </SettingsGroup>
      {token.status === "active" ? (
        <>
          <SettingsGroup footer="A new secret: the current one stops working at once. Name, permissions, devices and expiry stay.">
            <SettingsRow kind="action" label="Roll token" onClick={() => setRolling(token)} />
          </SettingsGroup>
          <SettingsGroup footer="Whatever uses it loses access at once, for good.">
            <SettingsRow
              kind="action"
              danger
              label="Revoke token"
              onClick={() => setRevoking(token)}
            />
          </SettingsGroup>
        </>
      ) : null}
      <RollApiTokenDialog token={rolling} onClose={() => setRolling(null)} />
      <RevokeApiTokenDialog token={revoking} onClose={() => setRevoking(null)} />
    </SettingsPage>
  );
}
