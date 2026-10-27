import { useFormatter } from "../../format/useFormatter";
import { useRevokeOtherSessions } from "../../queries/useRevokeOtherSessions";
import { useRevokeSession } from "../../queries/useRevokeSession";
import { useSessions } from "../../queries/useSessions";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { useNow } from "../../time/useNow";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";

/** Settings › Browsers: the browsers signed in to this account; any but this one can be signed out. */
export function BrowsersPage() {
  const format = useFormatter();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const announce = useAnnounce();
  const now = useNow(60_000);
  const others = (sessions.data ?? []).filter((session) => !session.current).length;

  return (
    <SettingsPage page="browsers">
      {revoke.isError || revokeOthers.isError ? (
        <ErrorState
          title="That browser was not signed out"
          error={revoke.error ?? revokeOthers.error}
        />
      ) : null}
      {sessions.isPending ? (
        <LoadingBlock label="Loading browsers">
          <Skeleton height="6rem" />
        </LoadingBlock>
      ) : sessions.isError ? (
        <ErrorState
          title="Browsers could not be loaded"
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
        />
      ) : (
        <>
          <SettingsGroup title="Signed-in browsers" id="browsers">
            {sessions.data.map((session) => (
              <SettingsRow
                key={session.id}
                kind="plain"
                icon="monitor"
                tone="blue"
                label={session.label}
                detail={`Active ${format.relative(session.lastSeenAt, now)}${session.ip === null ? "" : ` · ${session.ip}`} · signed in ${format.dateTime(session.createdAt)}`}
                value={session.current ? "This browser" : undefined}
                end={
                  session.current ? undefined : (
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
                  )
                }
              />
            ))}
          </SettingsGroup>
          {others > 0 ? (
            <SettingsGroup footer="Every browser but this one has to sign in again.">
              <SettingsRow
                kind="action"
                danger
                label="Sign out everywhere else"
                busy={revokeOthers.isPending}
                onClick={() =>
                  revokeOthers.mutate(undefined, {
                    onSuccess: () => announce("Signed out everywhere else."),
                  })
                }
              />
            </SettingsGroup>
          ) : null}
        </>
      )}
    </SettingsPage>
  );
}
