import { useFormatter } from "../../format/useFormatter";
import { useRevokeOtherSessions } from "../../queries/useRevokeOtherSessions";
import { useRevokeSession } from "../../queries/useRevokeSession";
import { useSessions } from "../../queries/useSessions";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";

/** Browsers signed in to this account; any but this one can be signed out from here. */
export function SessionsSection({ headingId }: { headingId: string }) {
  const format = useFormatter();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const announce = useAnnounce();
  const now = useNow(60_000);
  const others = (sessions.data ?? []).filter((session) => !session.current).length;

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Signed-in browsers
        </h2>
        {others > 0 ? (
          <Button
            icon="signOut"
            busy={revokeOthers.isPending}
            onClick={() =>
              revokeOthers.mutate(undefined, {
                onSuccess: () => announce("Signed out everywhere else."),
              })
            }
          >
            Sign out everywhere else
          </Button>
        ) : null}
      </div>
      {revoke.isError || revokeOthers.isError ? (
        <ErrorState
          title="That session was not signed out"
          error={revoke.error ?? revokeOthers.error}
        />
      ) : null}
      {sessions.isPending ? (
        <LoadingBlock label="Loading sessions">
          <Skeleton height="4.5rem" />
        </LoadingBlock>
      ) : sessions.isError ? (
        <ErrorState
          title="Sessions could not be loaded"
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
        />
      ) : (
        <PlainList className="row-list card card--flush">
          {sessions.data.map((session) => (
            <li key={session.id} className="row-list__item">
              <span className="settings__row-icon">
                <Icon name="monitor" />
              </span>
              <div className="row-list__main">
                <p className="row-list__title">
                  {session.label}
                  {session.current ? <span className="settings__tag">This browser</span> : null}
                </p>
                <p className="row-list__meta">
                  Active {format.relative(session.lastSeenAt, now)}
                  {session.ip === null ? null : ` · ${session.ip}`} · signed in{" "}
                  {format.dateTime(session.createdAt)}
                </p>
              </div>
              {session.current ? null : (
                <Button
                  variant="ghost"
                  icon="signOut"
                  busy={revoke.isPending && revoke.variables === session.id}
                  aria-label={`Sign out ${session.label}`}
                  onClick={() =>
                    revoke.mutate(session.id, {
                      onSuccess: () => announce(`${session.label} signed out.`),
                    })
                  }
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </PlainList>
      )}
    </section>
  );
}
