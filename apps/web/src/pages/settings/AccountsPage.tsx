import type { Invite } from "@trail/contracts/invite";
import { Navigate } from "react-router";
import { useSessionUser } from "../../app/useSessionUser";
import { useFormatter } from "../../format/useFormatter";
import { useAdminUsers } from "../../queries/useAdminUsers";
import { useInvites } from "../../queries/useInvites";
import { useRevokeInvite } from "../../queries/useRevokeInvite";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { settingsRootPath } from "../../settings/settingsTree";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { CreateInviteForm } from "./CreateInviteForm";
import "./settings.css";

function inviteState(invite: Invite, now: number): "used" | "expired" | "open" {
  if (invite.usedAt !== null) return "used";
  return Date.parse(invite.expiresAt) <= now ? "expired" : "open";
}

const inviteLabels = { used: "Used", expired: "Expired", open: "Open" } as const;

/** The heading of the table's group, which names the table and its scrolling box. */
const accountsHeadingId = "accounts";

/**
 * Settings › Accounts, for administrators: who has an account on this server,
 * and invitations for new people. Everyone else is sent to Settings itself.
 */
export function AccountsPage() {
  const user = useSessionUser();
  if (!user.isAdmin) return <Navigate to={settingsRootPath} replace />;
  return <Accounts />;
}

function Accounts() {
  const format = useFormatter();
  const scrollable = useScrollableFocus();
  const invites = useInvites(true);
  const users = useAdminUsers(true);
  const revoke = useRevokeInvite();
  const announce = useAnnounce();
  const now = useNow(60_000);

  return (
    <SettingsPage page="accounts">
      <SettingsGroup title="Invite someone" id="invite" variant="card">
        <CreateInviteForm />
      </SettingsGroup>

      {invites.isPending ? (
        <LoadingBlock label="Loading invitations">
          <Skeleton height="3rem" />
        </LoadingBlock>
      ) : invites.isError ? (
        <ErrorState
          title="Invitations could not be loaded"
          error={invites.error}
          onRetry={() => void invites.refetch()}
        />
      ) : (
        <SettingsGroup title="Invitations" id="invitations">
          {invites.data.length === 0 ? (
            <SettingsRow kind="plain" muted label="No invitations yet." />
          ) : (
            invites.data.map((invite) => {
              const state = inviteState(invite, now);
              return (
                <SettingsRow
                  key={invite.id}
                  kind="plain"
                  label={invite.email ?? "Anyone with the link"}
                  detail={
                    state === "used"
                      ? `Used ${format.dateTime(invite.usedAt ?? invite.createdAt)}${invite.usedByEmail === null ? "" : ` by ${invite.usedByEmail}`}`
                      : `Created ${format.dateTime(invite.createdAt)} · ${state === "open" ? "expires" : "expired"} ${format.dateTime(invite.expiresAt)}`
                  }
                  value={inviteLabels[state]}
                  end={
                    state === "open" ? (
                      <Button
                        variant="ghost"
                        icon="trash"
                        busy={revoke.isPending && revoke.variables === invite.id}
                        aria-label={`Revoke the invitation for ${invite.email ?? "anyone"}`}
                        onClick={() =>
                          revoke.mutate(invite.id, {
                            onSuccess: () => announce("Invitation revoked."),
                          })
                        }
                      >
                        Revoke
                      </Button>
                    ) : undefined
                  }
                />
              );
            })
          )}
        </SettingsGroup>
      )}

      {users.isPending ? (
        <LoadingBlock label="Loading accounts">
          <Skeleton height="3rem" />
        </LoadingBlock>
      ) : users.isError ? (
        <ErrorState
          title="Accounts could not be loaded"
          error={users.error}
          onRetry={() => void users.refetch()}
        />
      ) : (
        <SettingsGroup title="Accounts on this server" id={accountsHeadingId} variant="flush">
          <section className="table-scroll" aria-labelledby={accountsHeadingId} ref={scrollable}>
            <table className="table" aria-labelledby={accountsHeadingId}>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col" className="table__number">
                    Devices
                  </th>
                  <th scope="col" className="table__number">
                    Passkeys
                  </th>
                  <th scope="col">Last active</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <span className="settings__person">{account.displayName}</span>
                      {account.isAdmin ? <span className="settings__tag">Admin</span> : null}
                      <br />
                      <span className="table__muted">{account.email}</span>
                    </td>
                    <td className="table__number">{format.count(account.devices)}</td>
                    <td className="table__number">{format.count(account.passkeys)}</td>
                    <td>
                      {account.lastSeenAt === null ? "—" : format.relative(account.lastSeenAt, now)}
                    </td>
                    <td>{format.dateTime(account.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
