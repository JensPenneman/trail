import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type ApiToken,
  apiTokenRetentionDays,
  maxActiveApiTokens,
} from "@trail/contracts/apiToken";
import { useState } from "react";
import { useApiTokens } from "../../queries/useApiTokens";
import { useDevices } from "../../queries/useDevices";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { ApiTokenItem } from "./ApiTokenItem";
import { CreateApiTokenDialog } from "./CreateApiTokenDialog";
import { RevokeApiTokenDialog } from "./RevokeApiTokenDialog";
import { RollApiTokenDialog } from "./RollApiTokenDialog";
import "./ApiTokens.css";

/**
 * API tokens for scripts, apps and agents (docs/api.md): each with its own
 * permissions, devices, expiry and optional address allowlist. Only this
 * signed-in page manages them; a token can never manage tokens.
 */
export function ApiTokensSection({ headingId }: { headingId: string }) {
  const tokens = useApiTokens();
  const devices = useDevices();
  const now = useNow(60_000);
  const [creating, setCreating] = useState(false);
  const [rolling, setRolling] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  // A token may expire while the page is open: the list follows the clock, not the last fetch.
  const listed = (tokens.data ?? []).map((token) =>
    token.status === "active" && token.expiresAt !== null && Date.parse(token.expiresAt) <= now
      ? { ...token, status: "expired" as const }
      : token,
  );
  const active = listed.filter((token) => token.status === "active");
  const inactive = listed.filter((token) => token.status !== "active");
  const deviceNames = new Map((devices.data ?? []).map((device) => [device.id, device.name]));
  const full = active.length >= maxActiveApiTokens;
  const item = (token: ApiToken) => (
    <ApiTokenItem
      key={token.id}
      token={token}
      deviceNames={deviceNames}
      now={now}
      onRoll={setRolling}
      onRevoke={setRevoking}
    />
  );

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          API tokens
        </h2>
        <Button icon="plus" disabled={full} onClick={() => setCreating(true)}>
          Create token
        </Button>
      </div>
      <p className="section__description">
        A token lets a script, an app or an agent use the Trail API for you, with only the
        permissions and devices you give it. How to use one: the{" "}
        <a href={apiPaths.docs}>API reference</a>.
      </p>
      {full ? (
        <Notice tone="info" title={`${maxActiveApiTokens} active tokens`}>
          <p>
            That is the most an account can have. Revoke one you no longer use to create another.
          </p>
        </Notice>
      ) : null}
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
          {active.length === 0 ? (
            <p className="card muted">No active tokens.</p>
          ) : (
            <PlainList className="row-list card card--flush" label="Active tokens">
              {active.map(item)}
            </PlainList>
          )}
          {inactive.length === 0 ? null : (
            <div className="card card--flush">
              <div className="token-group__header">
                <h3 className="settings__subtitle">Expired and revoked</h3>
                <p className="muted token-group__note">
                  Kept for {apiTokenRetentionDays} days after they stop working, then removed.
                </p>
              </div>
              <PlainList className="row-list">{inactive.map(item)}</PlainList>
            </div>
          )}
        </>
      )}
      <CreateApiTokenDialog open={creating} onClose={() => setCreating(false)} />
      <RollApiTokenDialog token={rolling} onClose={() => setRolling(null)} />
      <RevokeApiTokenDialog token={revoking} onClose={() => setRevoking(null)} />
    </section>
  );
}
