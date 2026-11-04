import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import type { ReactNode, Ref } from "react";
import { useReadOnly } from "../../app/useReadOnly";
import type { PersonColors } from "../../people/usePersonColors";
import type { WhereTheyveBeenPeriod } from "../../people/WhereTheyveBeen";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/PageHeader";
import type { MapViewContent } from "../map/MapViewContent";
import { HiddenPeople } from "./HiddenPeople";
import { PeopleRoot } from "./PeopleRoot";
import { PersonPanel } from "./PersonPanel";
import { type SharingActions, shareOfflineId } from "./useSharingActions";

/** Which level of the sidebar is shown: the root, the Hidden list, or someone's page. */
type PanelLevelKey =
  | { level: "root" }
  | { level: "hidden" }
  | { level: "person"; selected: string };

interface PeoplePanelProps {
  panelRef: Ref<HTMLElement>;
  /** The history slider, first in the sheet on phones; null beside the map. */
  foot: ReactNode;
  at: PanelLevelKey;
  people: UseQueryResult<Person[]>;
  devices: UseQueryResult<DeviceSummary[]>;
  personColors: PersonColors;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  /** Someone's page, the Hidden level, and the root, as addresses. */
  linkTo: (person: string) => string;
  hiddenTo: string;
  backTo: string;
  name: string;
  content: MapViewContent;
  period: WhereTheyveBeenPeriod | null;
  sharing: SharingActions;
  onLeave: (key: string) => void;
}

/**
 * The sidebar, a bottom sheet on phones: the page's heading with the way to
 * share one's own location, then one level at a time — the root list of
 * people, the Hidden list below it, or a person's page.
 */
export function PeoplePanel({
  panelRef,
  foot,
  at,
  people,
  devices,
  personColors,
  now,
  thresholds,
  linkTo,
  hiddenTo,
  backTo,
  name,
  content,
  period,
  sharing,
  onLeave,
}: PeoplePanelProps) {
  const readOnly = useReadOnly();
  return (
    <section className="map-page__panel" aria-labelledby="people-page-title" ref={panelRef}>
      <span className="map-page__grabber" aria-hidden="true" />
      {foot}
      <div className="map-page__top">
        <PageHeader
          title="People"
          titleId="people-page-title"
          actions={
            <Button
              variant="ghost"
              icon="plus"
              iconOnly
              disabled={readOnly}
              aria-describedby={readOnly ? shareOfflineId : undefined}
              onClick={() => sharing.openShare()}
            >
              Share my location
            </Button>
          }
        />
        {sharing.offlineReason}
      </div>
      <div className="map-page__body">
        {at.level === "root" ? (
          <PeopleRoot
            people={people}
            devices={devices}
            personColors={personColors}
            now={now}
            thresholds={thresholds}
            linkTo={linkTo}
            hiddenTo={hiddenTo}
          />
        ) : at.level === "hidden" ? (
          <HiddenPeople backTo={backTo} />
        ) : (
          <PersonPanel
            selected={at.selected}
            backTo={backTo}
            name={name}
            devices={devices}
            people={people}
            personColors={personColors}
            now={now}
            thresholds={thresholds}
            content={content}
            period={period}
            sharing={sharing}
            onLeave={onLeave}
          />
        )}
      </div>
    </section>
  );
}
