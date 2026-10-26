import type { ApiToken } from "@trail/contracts/apiToken";
import { useFormatter } from "../../format/useFormatter";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { PlainList } from "../../ui/PlainList";
import "./ApiTokens.css";

const statusLabels: Record<ApiToken["status"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

interface ApiTokenItemProps {
  token: ApiToken;
  /** Device names by id, to say which devices a limited token reaches. */
  deviceNames: ReadonlyMap<string, string>;
  now: number;
  onRoll: (token: ApiToken) => void;
  onRevoke: (token: ApiToken) => void;
}

/** One token in the list: what it may do, where, until when, and when it was last used. */
export function ApiTokenItem({ token, deviceNames, now, onRoll, onRevoke }: ApiTokenItemProps) {
  const format = useFormatter();
  const devices =
    token.deviceIds === null
      ? "All devices"
      : token.deviceIds.length === 0
        ? "No devices"
        : format.list(token.deviceIds.map((id) => deviceNames.get(id) ?? "a device"));
  const addresses =
    token.allowedIps === null ? "from any address" : `from ${format.list(token.allowedIps)}`;
  const lifetime =
    token.status === "revoked"
      ? `Revoked ${format.dateTime(token.revokedAt ?? token.createdAt)}`
      : token.expiresAt === null
        ? "Never expires"
        : `${token.status === "expired" ? "Expired" : "Expires"} ${format.dateTime(token.expiresAt)}`;
  const lastUse =
    token.lastUsedAt === null
      ? "never used"
      : `last used ${format.relative(token.lastUsedAt, now)}${token.lastUsedIp === null ? "" : ` from ${token.lastUsedIp}`}`;

  return (
    <li className="row-list__item token-item">
      <span className="settings__row-icon">
        <Icon name="key" />
      </span>
      <div className="row-list__main token-item__main">
        <p className="row-list__title">
          {token.name}
          <span
            className={`settings__tag settings__tag--${token.status === "active" ? "open" : "expired"}`}
          >
            {statusLabels[token.status]}
          </span>
        </p>
        <p className="row-list__meta">
          <span className="mono">trlk_…{token.hint}</span> · {devices} {addresses}
        </p>
        <PlainList className="token-chips" label={`Scopes of ${token.name}`}>
          {token.scopes.map((scope) => (
            <li key={scope} className="token-chip mono">
              {scope}
            </li>
          ))}
        </PlainList>
        <p className="row-list__meta">
          {lifetime} · {lastUse} · created {format.dateTime(token.createdAt)}
        </p>
      </div>
      {token.status === "active" ? (
        <div className="settings__row-actions">
          <Button variant="ghost" icon="refresh" iconOnly onClick={() => onRoll(token)}>
            Roll {token.name}
          </Button>
          <Button variant="ghost" icon="trash" iconOnly onClick={() => onRevoke(token)}>
            Revoke {token.name}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
