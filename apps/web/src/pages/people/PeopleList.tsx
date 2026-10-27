import type { UseQueryResult } from "@tanstack/react-query";
import type { Person, SharedDevice } from "@trail/contracts/person";
import type { OutgoingShare } from "@trail/contracts/share";
import { type ReactNode, useContext, useId, useState } from "react";
import { Link } from "react-router";
import { useSessionUser } from "../../app/useSessionUser";
import { useFormatter } from "../../format/useFormatter";
import { LiveStoreContext } from "../../live/LiveStoreContext";
import { useLiveState } from "../../live/useLiveState";
import { PersonCard } from "../../people/PersonCard";
import type { PersonColors } from "../../people/usePersonColors";
import { useHidePerson } from "../../queries/useHidePerson";
import { useIncomingShares } from "../../queries/useIncomingShares";
import { useShares } from "../../queries/useShares";
import { ShareDialog, type ShareDialogMode } from "../../sharing/ShareDialog";
import { StopShareDialog } from "../../sharing/StopShareDialog";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { sharingSummary } from "./sharingSummary";

/** The share the signed-in person gives someone, by their account or their address. */
const shareWith = (person: Person, shares: readonly OutgoingShare[]): OutgoingShare | null =>
  shares.find(
    (share) => share.recipient.userId === person.userId || share.recipient.email === person.email,
  ) ?? null;

interface PeopleListProps {
  people: UseQueryResult<Person[]>;
  /** The people the map shows now (user ids). */
  shown: readonly string[];
  /** Whether the map shows everyone; null while fewer than two people share (nothing to add). */
  everyone: boolean | null;
  personColors: PersonColors;
  now: number;
  liveMinutes: number;
  onShow: (person: Person, device: SharedDevice) => void;
  onShowEveryone: () => void;
  /** A notice about the people shown, above their cards (a track that could not be loaded). */
  notice?: ReactNode;
}

/**
 * The people who share with the signed-in person, a card each in the order of
 * the list (Find My style), with who is on the map marked; those hidden, to
 * show again; then one's own side: Share my location, and with how many
 * people one shares, which Settings › Sharing manages.
 */
export function PeopleList({
  people,
  shown,
  everyone,
  personColors,
  now,
  liveMinutes,
  onShow,
  onShowEveryone,
  notice,
}: PeopleListProps) {
  const user = useSessionUser();
  const format = useFormatter();
  const headingId = useId();
  const shares = useShares();
  const incoming = useIncomingShares();
  const hide = useHidePerson();
  const announce = useAnnounce();
  const live = useLiveState();
  const store = useContext(LiveStoreContext);
  const [dialog, setDialog] = useState<ShareDialogMode | null>(null);
  const [stopping, setStopping] = useState<OutgoingShare | null>(null);

  const list = people.data ?? [];
  const outgoing = shares.data ?? [];
  const hidden = (incoming.data ?? []).filter((share) => share.hiddenAt !== null);
  const suggestions = list
    .filter((person) => shareWith(person, outgoing) === null)
    .map((person) => ({ name: person.displayName, email: person.email }));
  const notices = live.shareNotices.flatMap((entry) => {
    const person = list.find((candidate) => candidate.share.id === entry.shareId);
    return person === undefined ? [] : [{ notice: entry, person }];
  });
  const summary = sharingSummary(outgoing, format.count);

  return (
    <>
      <section className="section people-list" aria-labelledby={headingId}>
        <div className="section__header">
          <h2 className="section__title" id={headingId}>
            Sharing with you
          </h2>
          {everyone === null ? null : (
            <Button
              variant="ghost"
              className="people-list__everyone"
              icon={everyone ? "check" : "users"}
              aria-pressed={everyone}
              onClick={onShowEveryone}
            >
              Show everyone
            </Button>
          )}
        </div>

        {notices.map(({ notice: entry, person }) => (
          <Notice
            key={entry.shareId}
            tone="success"
            role="status"
            title={`${person.displayName} shares their location with you`}
            action={
              <Button variant="ghost" onClick={() => store?.dismissShareNotice(entry.shareId)}>
                OK
              </Button>
            }
          />
        ))}
        {notice}

        {people.isPending ? (
          <LoadingBlock label="Loading people">
            <Skeleton height="12rem" />
          </LoadingBlock>
        ) : people.isError ? (
          <ErrorState
            title="People could not be loaded"
            error={people.error}
            onRetry={() => void people.refetch()}
            retrying={people.isFetching}
          />
        ) : list.length === 0 ? (
          <div className="card">
            <EmptyState icon="users" title="Nobody shares with you yet" level={3}>
              <p>
                When someone shares their location with {user.email}, they appear here and on the
                map. Sharing works one way: share yours and they can share back.
              </p>
            </EmptyState>
          </div>
        ) : (
          <PlainList className="people-list__cards">
            {list.map((person) => {
              const share = shareWith(person, outgoing);
              return (
                <li key={person.userId}>
                  <PersonCard
                    person={person}
                    colorSlot={personColors.slot(person.userId)}
                    now={now}
                    liveMinutes={liveMinutes}
                    sharesBack={share !== null}
                    selected={shown.includes(person.userId)}
                    onShowOnMap={(device) => onShow(person, device)}
                    onShareBack={() => setDialog({ kind: "create", email: person.email })}
                    {...(share === null ? {} : { onStopSharing: () => setStopping(share) })}
                    hiding={hide.isPending && hide.variables.shareId === person.share.id}
                    onHide={() =>
                      hide.mutate(
                        { shareId: person.share.id, hidden: true },
                        {
                          onSuccess: () =>
                            announce(
                              `${person.displayName} is hidden. Show them again under Hidden.`,
                            ),
                        },
                      )
                    }
                  />
                </li>
              );
            })}
          </PlainList>
        )}
        {hide.isError ? <ErrorState title="Nobody was hidden" error={hide.error} /> : null}

        {hidden.length === 0 ? null : (
          <details className="disclosure people-list__hidden">
            <summary>
              <Icon name="chevronDown" className="disclosure__chevron" />
              <span>Hidden ({format.count(hidden.length)})</span>
            </summary>
            <PlainList className="card card--flush row-list">
              {hidden.map((share) => (
                <li key={share.id} className="row-list__item">
                  <div className="row-list__main">
                    <p className="row-list__title">{share.owner.displayName}</p>
                    <p className="row-list__meta">
                      Still shares with you; you see nothing of them while they are hidden.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    busy={hide.isPending && hide.variables.shareId === share.id}
                    aria-label={`Show ${share.owner.displayName} again`}
                    onClick={() =>
                      hide.mutate(
                        { shareId: share.id, hidden: false },
                        {
                          onSuccess: () => announce(`${share.owner.displayName} is shown again.`),
                        },
                      )
                    }
                  >
                    Show
                  </Button>
                </li>
              ))}
            </PlainList>
          </details>
        )}
      </section>

      <div className="people-list__yours">
        <Button variant="primary" icon="users" onClick={() => setDialog({ kind: "create" })}>
          Share my location
        </Button>
        {shares.isPending ? null : shares.isError ? (
          <ErrorState
            title="Your shares could not be loaded"
            error={shares.error}
            onRetry={() => void shares.refetch()}
            retrying={shares.isFetching}
          />
        ) : (
          <Link
            to="/settings/sharing"
            className="people-list__sharing"
            // The two lines read as one sentence, which the grid of their boxes would not make.
            aria-label={`${summary.line}${summary.toConfirm === null ? "" : `, ${summary.toConfirm}`}: Settings › Sharing`}
          >
            <span className="people-list__sharing-text">
              <span className="people-list__sharing-line">{summary.line}</span>
              <span className="people-list__sharing-where">
                {summary.toConfirm === null ? "" : `${summary.toConfirm} · `}Settings › Sharing
              </span>
            </span>
            <Icon name="chevronRight" className="people-list__sharing-chevron" />
          </Link>
        )}
      </div>

      <ShareDialog mode={dialog} onClose={() => setDialog(null)} suggestions={suggestions} />
      <StopShareDialog share={stopping} onClose={() => setStopping(null)} />
    </>
  );
}
