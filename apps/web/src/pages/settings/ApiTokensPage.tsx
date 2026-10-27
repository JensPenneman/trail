import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type ApiToken,
  apiTokenRetentionDays,
  maxActiveApiTokens,
} from "@trail/contracts/apiToken";
import { useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useApiTokens } from "../../queries/useApiTokens";
import { useDevices } from "../../queries/useDevices";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { useNow } from "../../time/useNow";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { Skeleton } from "../../ui/Skeleton";
import { CreateApiTokenDialog } from "./CreateApiTokenDialog";
import { mcpGuideUrl } from "./mcpGuide";
import { tokenAsOf, tokenDevicesText, tokenLifetimeText, tokenStatusLabels } from "./tokenText";

/**
 * Settings › API tokens (docs/api.md): a page per token — what it may do,
 * where, until when; roll, revoke — and creating one. Only a signed-in
 * browser manages them; a token can never manage tokens.
 */
export function ApiTokensPage() {
  const format = useFormatter();
  const tokens = useApiTokens();
  const devices = useDevices();
  const now = useNow(60_000);
  const [creating, setCreating] = useState(false);

  // A token may expire while the page is open: the list follows the clock, not the last fetch.
  const listed = (tokens.data ?? []).map((token) => tokenAsOf(token, now));
  const active = listed.filter((token) => token.status === "active");
  const inactive = listed.filter((token) => token.status !== "active");
  const deviceNames = new Map((devices.data ?? []).map((device) => [device.id, device.name]));
  const full = active.length >= maxActiveApiTokens;
  const row = (token: ApiToken) => (
    <SettingsRow
      key={token.id}
      kind="link"
      to={`/settings/tokens/${encodeURIComponent(token.id)}`}
      icon="code"
      tone="gray"
      label={token.name}
      detail={`trlk_…${token.hint} · ${tokenDevicesText(token, deviceNames, format)} · ${tokenLifetimeText(token, format)}`}
      value={token.status === "active" ? undefined : tokenStatusLabels[token.status]}
    />
  );

  return (
    <SettingsPage
      page="tokens"
      description={
        <>
          A token lets a script, an app or an agent use the Trail API for you, with only the
          permissions and devices you give it. How to use one: the{" "}
          <a href={apiPaths.docs}>API reference</a>, and for an agent the{" "}
          <a href={mcpGuideUrl} target="_blank" rel="noreferrer">
            MCP guide
          </a>
          .
        </>
      }
    >
      {full ? (
        <Notice tone="info" title={`${maxActiveApiTokens} active tokens`}>
          <p>
            That is the most an account can have. Revoke one you no longer use to create another.
          </p>
        </Notice>
      ) : null}
      <SettingsGroup>
        <SettingsRow
          kind="action"
          icon="plus"
          tone="gray"
          label="Create token"
          disabled={full}
          onClick={() => setCreating(true)}
        />
      </SettingsGroup>
      {tokens.isPending ? (
        <LoadingBlock label="Loading API tokens">
          <Skeleton height="5.5rem" />
        </LoadingBlock>
      ) : tokens.isError ? (
        <ErrorState
          title="API tokens could not be loaded"
          error={tokens.error}
          onRetry={() => void tokens.refetch()}
        />
      ) : (
        <>
          <SettingsGroup title="Active tokens">
            {active.length === 0 ? (
              <SettingsRow kind="plain" muted label="No active tokens." />
            ) : (
              active.map(row)
            )}
          </SettingsGroup>
          {inactive.length === 0 ? null : (
            <SettingsGroup
              title="Expired and revoked"
              footer={`Kept for ${apiTokenRetentionDays} days after they stop working, then removed.`}
            >
              {inactive.map(row)}
            </SettingsGroup>
          )}
        </>
      )}
      <CreateApiTokenDialog open={creating} onClose={() => setCreating(false)} />
    </SettingsPage>
  );
}
