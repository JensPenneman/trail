import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import { type ReactNode, useContext } from "react";
import { Link } from "react-router";
import { offlineReasonId, useReadOnly } from "../../app/useReadOnly";
import { useSessionUser } from "../../app/useSessionUser";
import { useFormatter } from "../../format/useFormatter";
import { LiveStoreContext } from "../../live/LiveStoreContext";
import { useLiveState } from "../../live/useLiveState";
import type { PersonColors } from "../../people/usePersonColors";
import { useHidePerson } from "../../queries/useHidePerson";
import { useIncomingShares } from "../../queries/useIncomingShares";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";
import { ConnectFirstPhone } from "./MeDetails";
import { MeRow, PersonRow } from "./PersonRow";
import { sharingSummary } from "./sharingSummary";
import type { SharingActions } from "./useSharingActions";
import "./PeopleList.css";

interface PeopleListProps {
  people: UseQueryResult<Person[]>;
  devices: UseQueryResult<DeviceSummary[]>;
  personColors: PersonColors;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  /** The detail of someone (`me` or a user id). */
  linkTo: (person: string) => string;
  /** The view's part of the list (History's summary, Heat's totals), above the people. */
  panel: ReactNode;
  sharing: SharingActions;
}

/**
 * The People page's list, Find My style: Me first, then everyone who shares
 * with the signed-in person, a row each that opens their detail; those hidden,
 * to show again; and the signed-in person's own side, quietly: with how many
 * people one shares, which Settings › Sharing manages. Where nobody shares
 * yet, one card says so and offers Share my location.
 */
export function PeopleList({
  people,
  devices,
  personColors,
  now,
  thresholds,
  linkTo,
  panel,
  sharing,
}: PeopleListProps) {
  const user = useSessionUser();
  const format = useFormatter();
  const incoming = useIncomingShares();
  const hide = useHidePerson();
  const announce = useAnnounce();
  const live = useLiveState();
  const store = useContext(LiveStoreContext);
  const readOnly = useReadOnly();

  const list = people.data ?? [];
  const hidden = (incoming.data ?? []).filter((share) => share.hiddenAt !== null);
  const notices = live.shareNotices.flatMap((entry) => {
    const person = list.find((candidate) => candidate.share.id === entry.shareId);
    return person === undefined ? [] : [{ notice: entry, person }];
  });
  const summary = sharingSummary(sharing.shares.data ?? [], format.count);
  const sharingLink = sharing.shares.isPending ? null : sharing.shares.isError ? (
    <ErrorState
      title="Your shares could not be loaded"
      error={sharing.shares.error}
      onRetry={() => void sharing.shares.refetch()}
      retrying={sharing.shares.isFetching}
    />
  ) : (
    <Link
      to="/settings/sharing"
      className="people-list__sharing"
      // The two lines read as one sentence, which the grid of their boxes would not make;
      // the name keeps the visible text whole (WCAG 2.5.3, Label in Name).
      aria-label={`${summary.line} ${summary.toConfirm === null ? "" : `${summary.toConfirm} · `}Settings › Sharing`}
    >
      <span className="people-list__sharing-text">
        <span className="people-list__sharing-line">{summary.line}</span>{" "}
        <span className="people-list__sharing-where">
          {summary.toConfirm === null ? "" : `${summary.toConfirm} · `}Settings › Sharing
        </span>
      </span>
      <Icon name="chevronRight" className="people-list__sharing-chevron" />
    </Link>
  );
  const nobodyShares = people.isSuccess && list.length === 0;

  return (
    <div className="people-list">
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

      {panel}

      <PlainList className="people-list__rows" label="People">
        <li>
          <MeRow
            name={user.displayName}
            devices={devices}
            now={now}
            thresholds={thresholds}
            to={linkTo("me")}
          />
          {devices.isError ? (
            <ErrorState
              title="Your devices could not be loaded"
              error={devices.error}
              onRetry={() => void devices.refetch()}
              retrying={devices.isFetching}
            />
          ) : devices.data !== undefined && devices.data.length === 0 ? (
            <ConnectFirstPhone level={2} />
          ) : null}
        </li>
        {list.map((person) => (
          <li key={person.userId}>
            <PersonRow
              person={person}
              colorSlot={personColors.slot(person.userId)}
              now={now}
              liveMinutes={thresholds.liveMinutes}
              to={linkTo(person.userId)}
            />
          </li>
        ))}
      </PlainList>

      {people.isPending ? (
        <LoadingBlock label="Loading people">
          <Skeleton height="4rem" />
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : people.isError ? (
        <ErrorState
          title="People could not be loaded"
          error={people.error}
          onRetry={() => void people.refetch()}
          retrying={people.isFetching}
        />
      ) : null}
      {hide.isError ? <ErrorState title="Nobody was shown again" error={hide.error} /> : null}

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
                  disabled={readOnly}
                  aria-describedby={readOnly ? offlineReasonId : undefined}
                  aria-label={`Show ${share.owner.displayName} again`}
                  onClick={() =>
                    hide.mutate(
                      { shareId: share.id, hidden: false },
                      { onSuccess: () => announce(`${share.owner.displayName} is shown again.`) },
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

      {nobodyShares ? (
        <div className="card">
          <EmptyState icon="users" title="Nobody shares with you yet" level={2}>
            <p>
              When someone shares their location with {user.email}, they appear here and on the map.
              Sharing works one way: share yours and they can share back.
            </p>
          </EmptyState>
          <div className="people-list__invite">
            <Button
              variant="primary"
              icon="plus"
              disabled={readOnly}
              aria-describedby={readOnly ? offlineReasonId : undefined}
              onClick={() => sharing.openShare()}
            >
              Share my location
            </Button>
            {sharingLink}
          </div>
        </div>
      ) : list.length > 0 ? (
        <div className="people-list__footer">{sharingLink}</div>
      ) : null}
    </div>
  );
}
