import type { UseQueryResult } from "@tanstack/react-query";
import type { Person } from "@trail/contracts/person";
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { appleMapsUrl, googleMapsUrl } from "../../people/mapLinks";
import { PersonDevices } from "../../people/PersonDevices";
import { PersonSummary } from "../../people/PersonSummary";
import type { PersonTrackState } from "../../people/PersonTrackState";
import { personSummaryProps } from "../../people/personSummaryProps";
import { primaryDevice } from "../../people/primaryDevice";
import { ShareTerms } from "../../people/ShareTerms";
import type { PersonColors } from "../../people/usePersonColors";
import { WhereTheyveBeen, type WhereTheyveBeenPeriod } from "../../people/WhereTheyveBeen";
import { SettingsDisclosureGroup } from "../../settings/SettingsDisclosureGroup";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { Button } from "../../ui/Button";
import "../../ui/BackLink.css";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { SectionLevel } from "../../ui/SectionTitle";
import { Skeleton } from "../../ui/Skeleton";
import type { MapViewContent } from "../map/MapViewContent";
import type { SharingActions } from "./useSharingActions";

interface PersonPageProps {
  /** The user id of someone who shares with the signed-in person. */
  selected: string;
  /** The root: the page's address without the selection. */
  backTo: string;
  people: UseQueryResult<Person[]>;
  personColors: PersonColors;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  content: MapViewContent;
  /** The day or period their track is for; null where the view draws no tracks of others (Heat). */
  period: WhereTheyveBeenPeriod | null;
  sharing: SharingActions;
  /** History's slider on phones: right under the header, so the sheet's peek does not hold it. */
  foot: ReactNode;
  /** Leaves the page for the root (after hiding someone). */
  onLeave: (key: string) => void;
}

/**
 * Someone's page, in place of the root: who they are, how fresh and what they
 * are doing; where they have been (the day, with a way to another); in History
 * the summary of their tracks, folded; their devices and what they share,
 * folded; then rows for what can be done: the spot in Apple or Google Maps,
 * share back or stop, hide.
 */
export function PersonPage({
  selected,
  backTo,
  people,
  personColors,
  now,
  thresholds,
  content,
  period,
  sharing,
  foot,
  onLeave,
}: PersonPageProps) {
  const titleId = useId();
  const format = useFormatter();
  const [opened, setOpened] = useState<Readonly<Record<string, boolean>>>({});
  const group = (title: string) => ({
    open: opened[title] === true,
    onOpenChange: (open: boolean) => setOpened((current) => ({ ...current, [title]: open })),
  });
  const back = (
    <Link to={backTo} className="back-link" preventScrollReset>
      <Icon name="chevronLeft" className="back-link__icon" />
      <span className="back-link__label">
        <span className="visually-hidden">Back to</span> People
      </span>
    </Link>
  );
  const person = people.data?.find((candidate) => candidate.userId === selected);
  // One tree whether they are loaded or not, so the back link is not remounted when they load.
  const loadingOrError = people.isError ? (
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
  const body = (found: Person) => {
    const share = sharing.shareWith(found);
    const track: PersonTrackState | null = content.personTracks.get(found.userId) ?? null;
    const where = primaryDevice(found.devices)?.location ?? null;
    const name = found.displayName;
    const devicesTitle = `${found.devices.length === 1 ? "Device" : "Devices"} (${format.count(found.devices.length)}) · What ${name} shares with you`;

    return (
      <>
        <PersonSummary
          title={name}
          titleId={titleId}
          level={2}
          {...personSummaryProps(
            found,
            personColors.slot(found.userId),
            now,
            thresholds.liveMinutes,
            format,
          )}
        />
        {foot}
        {period === null ? null : (
          <WhereTheyveBeen
            person={found}
            period={period}
            track={track}
            titleId={titleId}
            now={now}
          />
        )}
        {content.personGroup === null ? null : (
          <SettingsDisclosureGroup title="Summary" {...group("Summary")}>
            {content.personGroup}
          </SettingsDisclosureGroup>
        )}
        <SettingsDisclosureGroup title={devicesTitle} {...group("Devices")}>
          <PersonDevices person={found} now={now} liveMinutes={thresholds.liveMinutes} />
          <ShareTerms person={found} now={now} />
        </SettingsDisclosureGroup>

        {sharing.hideError === null ? null : (
          <ErrorState title="Nobody was hidden" error={sharing.hideError} />
        )}
        <SettingsGroup>
          {where === null ? null : (
            <>
              <SettingsRow
                kind="external"
                href={appleMapsUrl(where.lat, where.lon, name)}
                newTab
                label="Open in Apple Maps"
              />
              <SettingsRow
                kind="external"
                href={googleMapsUrl(where.lat, where.lon)}
                newTab
                label="Open in Google Maps"
              />
            </>
          )}
          {share === null ? (
            <SettingsRow
              kind="action"
              label={`Share back with ${name}`}
              onClick={() => sharing.openShare(found.email)}
            />
          ) : (
            <SettingsRow
              kind="plain"
              label={`You share with ${name}`}
              end={
                <Button
                  variant="danger-outline"
                  onClick={() => sharing.openStop(share)}
                  aria-label={`Stop sharing your location with ${name}`}
                >
                  Stop
                </Button>
              }
            />
          )}
          <SettingsRow
            kind="action"
            danger
            label={`Hide ${name}`}
            busy={sharing.hiding(found.share.id)}
            onClick={() => sharing.hide(found, () => onLeave(found.userId))}
          />
        </SettingsGroup>
      </>
    );
  };

  return (
    <section className="person-panel" aria-labelledby={titleId}>
      <SectionLevel value={3}>
        {back}
        {person === undefined ? loadingOrError : body(person)}
      </SectionLevel>
    </section>
  );
}
