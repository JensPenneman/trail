import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import { useId } from "react";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { PersonDetails } from "../../people/PersonDetails";
import { PersonSummary } from "../../people/PersonSummary";
import type { PersonTrackState } from "../../people/PersonTrackState";
import { personSummaryProps } from "../../people/personSummaryProps";
import type { PersonColors } from "../../people/usePersonColors";
import { WhereTheyveBeen, type WhereTheyveBeenPeriod } from "../../people/WhereTheyveBeen";
import "../../ui/BackLink.css";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { SectionLevel } from "../../ui/SectionTitle";
import { Skeleton } from "../../ui/Skeleton";
import type { MapViewContent } from "../map/MapViewContent";
import { me } from "../map/me";
import { MeDetails } from "./MeDetails";
import { useMeSummary } from "./useMeSummary";
import type { SharingActions } from "./useSharingActions";

interface PersonPanelProps {
  /** `me`, or the user id of someone who shares with the signed-in person. */
  selected: string;
  /** The list: the page's address without the selection. */
  backTo: string;
  name: string;
  devices: UseQueryResult<DeviceSummary[]>;
  people: UseQueryResult<Person[]>;
  personColors: PersonColors;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  content: MapViewContent;
  /** The day or period their track is for; null where the view draws no tracks of others (Heat). */
  period: WhereTheyveBeenPeriod | null;
  sharing: SharingActions;
  /** Leaves the detail for the list (after hiding someone). */
  onLeave: (key: string) => void;
}

/**
 * Someone's detail, in place of the list: a way back, their name, how fresh
 * and what they are doing, how far and the battery, then what the view has to
 * say of them. For Me that is one's own — the day so far (Live), the timeline,
 * visits and trips (History) — and the devices; for someone who shares it is
 * where they have been, what they share and the rest of what can be done with
 * the share: share back or stop, hide.
 */
export function PersonPanel(props: PersonPanelProps) {
  const { selected, backTo, name, devices, now, thresholds, content } = props;
  const titleId = useId();
  const mine = selected === me;
  return (
    <section className="person-panel" aria-labelledby={titleId}>
      <SectionLevel value={3}>
        <Link to={backTo} className="back-link" preventScrollReset>
          <Icon name="chevronLeft" className="back-link__icon" />
          <span className="back-link__label">
            <span className="visually-hidden">Back to</span> People
          </span>
        </Link>
        {mine ? (
          <MeBody
            titleId={titleId}
            name={name}
            devices={devices}
            now={now}
            thresholds={thresholds}
            content={content}
          />
        ) : (
          <OtherBody {...props} titleId={titleId} />
        )}
      </SectionLevel>
    </section>
  );
}

function ViewParts({ content, mine }: { content: MapViewContent; mine: boolean }) {
  return (
    <>
      {content.panel === null ? null : (
        <section className="map-page__details" aria-label={content.panelLabel}>
          {content.panel}
        </section>
      )}
      {!mine || content.mine === null ? null : (
        <section className="map-page__details" aria-label={content.mineLabel}>
          {content.mine}
        </section>
      )}
    </>
  );
}

function MeBody({
  titleId,
  name,
  devices,
  now,
  thresholds,
  content,
}: {
  titleId: string;
  name: string;
  devices: UseQueryResult<DeviceSummary[]>;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  content: MapViewContent;
}) {
  const summary = useMeSummary(devices, now, thresholds);
  return (
    <>
      <PersonSummary
        title="Me"
        titleId={titleId}
        level={2}
        avatar={{ name, slot: "me" }}
        freshness={summary.freshness}
        doing={summary.doing}
      />
      <ViewParts content={content} mine />
      <MeDetails devices={devices} now={now} thresholds={thresholds} summary={summary} />
    </>
  );
}

function OtherBody({
  titleId,
  selected,
  people,
  personColors,
  now,
  thresholds,
  content,
  period,
  sharing,
  onLeave,
}: PersonPanelProps & { titleId: string }) {
  const format = useFormatter();
  const person = people.data?.find((candidate) => candidate.userId === selected);
  if (person === undefined) {
    return people.isError ? (
      <ErrorState
        title="People could not be loaded"
        error={people.error}
        onRetry={() => void people.refetch()}
        retrying={people.isFetching}
      />
    ) : (
      <LoadingBlock label="Loading">
        <Skeleton height="4rem" />
        <Skeleton height="8rem" />
      </LoadingBlock>
    );
  }
  const share = sharing.shareWith(person);
  const track: PersonTrackState | null = content.personTracks.get(person.userId) ?? null;
  return (
    <>
      <PersonSummary
        title={person.displayName}
        titleId={titleId}
        level={2}
        {...personSummaryProps(
          person,
          personColors.slot(person.userId),
          now,
          thresholds.liveMinutes,
          format,
        )}
      />
      {period === null ? null : (
        <WhereTheyveBeen
          person={person}
          period={period}
          track={track}
          titleId={titleId}
          now={now}
        />
      )}
      <ViewParts content={content} mine={false} />
      {sharing.hideError === null ? null : (
        <ErrorState title="Nobody was hidden" error={sharing.hideError} />
      )}
      <PersonDetails
        person={person}
        now={now}
        liveMinutes={thresholds.liveMinutes}
        sharesBack={share !== null}
        onShareBack={() => sharing.openShare(person.email)}
        {...(share === null ? {} : { onStopSharing: () => sharing.openStop(share) })}
        onHide={() => sharing.hide(person, () => onLeave(person.userId))}
        hiding={sharing.hiding(person.share.id)}
      />
    </>
  );
}
