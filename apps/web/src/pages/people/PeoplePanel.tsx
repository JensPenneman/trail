import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import { type ReactNode, type Ref, useRef } from "react";
import { useReadOnly } from "../../app/useReadOnly";
import type { PersonColors } from "../../people/usePersonColors";
import type { WhereTheyveBeenPeriod } from "../../people/WhereTheyveBeen";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/PageHeader";
import type { MapViewContent } from "../map/MapViewContent";
import { me } from "../map/me";
import { DevicesLevel } from "./DevicesLevel";
import type { Groups } from "./groupState";
import { HiddenPeople } from "./HiddenPeople";
import { MePage } from "./MePage";
import { PeopleRoot } from "./PeopleRoot";
import { PersonPage } from "./PersonPage";
import { type SharingActions, shareOfflineId } from "./useSharingActions";

/** Which level of the sidebar is shown: the root, the Hidden list, or someone's page. */
type PanelLevelKey =
  | { level: "root" }
  | { level: "hidden" }
  | { level: "devices" }
  | { level: "person"; selected: string };

interface PeoplePanelProps {
  panelRef: Ref<HTMLElement>;
  /** The history slider on phones, right under the header of the level; null beside the map. */
  foot: ReactNode;
  /** The playback bar on phones, in the sheet while it plays; null beside the map. */
  bar: ReactNode;
  /** What stands in for the sidebar's content while History plays ("At this moment"). */
  strip: ReactNode;
  at: PanelLevelKey;
  people: UseQueryResult<Person[]>;
  devices: UseQueryResult<DeviceSummary[]>;
  personColors: PersonColors;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  /** Someone's page, the Hidden level, and the root, as addresses. */
  linkTo: (person: string) => string;
  hiddenTo: string;
  /** The root, from someone's page. */
  backTo: string;
  /** The level above a level (the root from Hidden, Me's page from its devices), choices kept. */
  levelBackTo: string;
  /** Me's devices, a level of Me's page. */
  devicesTo: string;
  query: string;
  onQuery: (query: string) => void;
  name: string;
  content: MapViewContent;
  period: WhereTheyveBeenPeriod | null;
  sharing: SharingActions;
  /** Which folded groups of the page shown are open. */
  groups: Groups;
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
  bar,
  strip,
  at,
  people,
  devices,
  personColors,
  now,
  thresholds,
  linkTo,
  hiddenTo,
  backTo,
  levelBackTo,
  devicesTo,
  query,
  onQuery,
  name,
  content,
  period,
  sharing,
  groups,
  onLeave,
}: PeoplePanelProps) {
  const readOnly = useReadOnly();
  const playing = strip !== null;
  const sidebar = (
    <>
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
            query={query}
            onQuery={onQuery}
            foot={foot}
          />
        ) : at.level === "hidden" ? (
          <HiddenPeople backTo={levelBackTo} foot={foot} />
        ) : at.level === "devices" ? (
          <DevicesLevel
            backTo={levelBackTo}
            devices={devices}
            now={now}
            thresholds={thresholds}
            foot={foot}
          />
        ) : at.selected === me ? (
          <MePage
            backTo={backTo}
            devicesTo={devicesTo}
            foot={foot}
            name={name}
            devices={devices}
            now={now}
            thresholds={thresholds}
            content={content}
            sharing={sharing}
            groups={groups}
          />
        ) : (
          <PersonPage
            selected={at.selected}
            backTo={backTo}
            people={people}
            personColors={personColors}
            now={now}
            thresholds={thresholds}
            content={content}
            period={period}
            sharing={sharing}
            groups={groups}
            foot={foot}
            onLeave={onLeave}
          />
        )}
      </div>
    </>
  );
  // While it plays the same element is handed on again, so that the hidden content is not
  // rendered at every tick of the clock.
  const kept = useRef<ReactNode>(sidebar);
  if (!playing) kept.current = sidebar;
  return (
    <section
      className="map-page__panel"
      {...(playing
        ? { "aria-label": "History playback" }
        : { "aria-labelledby": "people-page-title" })}
      ref={panelRef}
    >
      <span className="map-page__grabber" aria-hidden="true" />
      {/* Mounted all along, hidden while playing: what is open and typed in it stays. */}
      <div hidden={playing}>{playing ? kept.current : sidebar}</div>
      {playing ? (
        <>
          {/* The page's own heading is in the hidden sidebar: this one says what is on screen. */}
          <h1 className="visually-hidden">History playback</h1>
          {bar}
          <div className="map-page__now" data-peek-end>
            {strip}
          </div>
        </>
      ) : null}
    </section>
  );
}
