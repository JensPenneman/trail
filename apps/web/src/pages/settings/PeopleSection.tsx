import type { Invite } from "@trail/contracts/invite";
import { useFormatter } from "../../format/useFormatter";
import { useAdminUsers } from "../../queries/useAdminUsers";
import { useInvites } from "../../queries/useInvites";
import { useRevokeInvite } from "../../queries/useRevokeInvite";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { CreateInviteForm } from "./CreateInviteForm";

function inviteState(invite: Invite, now: number): "used" | "expired" | "open" {
  if (invite.usedAt !== null) return "used";
  return Date.parse(invite.expiresAt) <= now ? "expired" : "open";
}

/** Admins only: who has an account on this server, and invitations for new people. */
export function PeopleSection({ headingId }: { headingId: string }) {
  const format = useFormatter();
  const invites = useInvites(true);
  const users = useAdminUsers(true);
  const revoke = useRevokeInvite();
  const announce = useAnnounce();
  const now = useNow(60_000);

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        People
      </h2>
      <div className="card">
        <h3 className="settings__subtitle">Invite someone</h3>
        <CreateInviteForm />
      </div>

      <div className="card card--flush">
        <h3 className="settings__subtitle settings__subtitle--padded">Invitations</h3>
        {invites.isPending ? (
          <LoadingBlock label="Loading invitations">
            <Skeleton height="3rem" />
          </LoadingBlock>
        ) : invites.isError ? (
          <div className="settings__padded">
            <ErrorState
              title="Invitations could not be loaded"
              error={invites.error}
              onRetry={() => void invites.refetch()}
            />
          </div>
        ) : invites.data.length === 0 ? (
          <p className="muted settings__padded">No invitations yet.</p>
        ) : (
          <PlainList className="row-list">
            {invites.data.map((invite) => {
              const state = inviteState(invite, now);
              return (
                <li key={invite.id} className="row-list__item">
                  <div className="row-list__main">
                    <p className="row-list__title">
                      {invite.email ?? "Anyone with the link"}
                      <span className={`settings__tag settings__tag--${state}`}>
                        {state === "used" ? "Used" : state === "expired" ? "Expired" : "Open"}
                      </span>
                    </p>
                    <p className="row-list__meta">
                      {state === "used"
                        ? `Used ${format.dateTime(invite.usedAt ?? invite.createdAt)}${invite.usedByEmail === null ? "" : ` by ${invite.usedByEmail}`}`
                        : `Created ${format.dateTime(invite.createdAt)} · ${state === "open" ? "expires" : "expired"} ${format.dateTime(invite.expiresAt)}`}
                    </p>
                  </div>
                  {state === "open" ? (
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
                  ) : null}
                </li>
              );
            })}
          </PlainList>
        )}
      </div>

      <div className="card card--flush">
        <h3 className="settings__subtitle settings__subtitle--padded">Accounts</h3>
        {users.isPending ? (
          <LoadingBlock label="Loading accounts">
            <Skeleton height="3rem" />
          </LoadingBlock>
        ) : users.isError ? (
          <div className="settings__padded">
            <ErrorState
              title="Accounts could not be loaded"
              error={users.error}
              onRetry={() => void users.refetch()}
            />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table">
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
          </div>
        )}
      </div>
    </section>
  );
}
