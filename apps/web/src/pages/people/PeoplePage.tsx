import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useReadOnly } from "../../app/useReadOnly";
import { useSessionUser } from "../../app/useSessionUser";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import { mapStyleLabels } from "../../map/mapStyleChoices";
import type { MapViewState } from "../../map/mapTypes";
import { useMapStyle } from "../../map/useMapStyle";
import { usePersonColors } from "../../people/usePersonColors";
import type { WhereTheyveBeenPeriod } from "../../people/WhereTheyveBeen";
import { useConfig } from "../../queries/useConfig";
import { useDevices } from "../../queries/useDevices";
import { usePeople } from "../../queries/usePeople";
import { useNow } from "../../time/useNow";
import { LevelControl, levelLabels } from "../../transport/LevelControl";
import { ModeLegend } from "../../transport/ModeLegend";
import { useTrackLevel } from "../../transport/useTrackLevel";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { PageHeader } from "../../ui/PageHeader";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { DeviceFilter, type DeviceFilterGroup } from "../map/DeviceFilter";
import { useHeatView } from "../map/heat/useHeatView";
import { useHistoryView } from "../map/history/useHistoryView";
import { useLiveView } from "../map/live/useLiveView";
import { MapOptions } from "../map/MapOptions";
import type { MapPerson } from "../map/MapPerson";
import { MapStyleControl } from "../map/MapStyleControl";
import { withPerson } from "../map/mapSearchUpdates";
import { type MapView, shownView, viewsFor } from "../map/mapViews";
import { me } from "../map/me";
import { resolveMapSelection } from "../map/resolveMapSelection";
import { useMapSearch } from "../map/useMapSearch";
import { ViewSwitch } from "../map/ViewSwitch";
import { PeopleList } from "./PeopleList";
import { PersonPanel } from "./PersonPanel";
import { usePanelFocus } from "./usePanelFocus";
import { shareOfflineId, useSharingActions } from "./useSharingActions";
import "./PeoplePage.css";

const defaultThresholds = { liveMinutes: 15, staleHours: 12 };
/** Where the map sits beside the panel instead of inside the scrolling page. */
const besideThePanel = "(min-width: 64rem)";

/**
 * The People page, Trail's home (docs/architecture.md §14): one map with its
 * three views — Live, History and Heat — and the choices they share (who is
 * selected, which of their devices, the map style, the tracks' level), all in
 * the URL; beside it the people, Find My style: a list with Me first and then
 * everyone who shares with the signed-in person, each where they are and what
 * they are doing. Selecting one (`?person=`) replaces the list with their
 * detail and draws what can be drawn of them: one's own tracks, timeline,
 * visits, trips and heatmap while Me is selected, someone's track where their
 * share includes it. With nobody selected the map shows positions (Live) or
 * everyone's tracks (History) and asks for no more. Every view keeps its state
 * and its queries in a hook that asks for nothing while another view is shown,
 * so the map itself, with its camera, stays as it is when the view changes.
 * What the devices send is Settings › Devices'.
 */
export function PeoplePage() {
  const user = useSessionUser();
  const {
    search,
    today,
    setView,
    adoptPerson,
    leavePerson,
    setDevices,
    showDay,
    showHistoryDay,
    showRange,
  } = useMapSearch();
  const { level, setLevel } = useTrackLevel();
  const mapStyle = useMapStyle();
  const config = useConfig();
  const devices = useDevices();
  const people = usePeople();
  const colors = useDeviceColors({ dark: mapStyle.dark });
  const personColors = usePersonColors({ dark: mapStyle.dark });
  const now = useNow(15_000);
  const wide = useMediaQuery(besideThePanel);
  const scrollable = useScrollableFocus();
  const readOnly = useReadOnly();
  const thresholds = config.data?.thresholds ?? defaultThresholds;
  const [viewport, setViewport] = useState<MapViewState | null>(null);
  // The device filter is folded away among the map's options, and open when an address sets one.
  const [filterOpen] = useState(() => search.devices !== null);
  const sharing = useSharingActions(people.data ?? []);

  const available = useMemo<MapPerson[]>(
    () => [
      {
        key: me,
        name: "Me",
        devices: (devices.data ?? []).map((device) => ({ id: device.id, name: device.name })),
      },
      ...(people.data ?? []).map((person) => ({
        key: person.userId,
        name: person.displayName,
        devices: person.devices.map((device) => ({ id: device.id, name: device.name })),
      })),
    ],
    [devices.data, people.data],
  );
  // Without the people (a failed request) the map still shows one's own.
  const complete = devices.data !== undefined && (people.data !== undefined || people.isError);
  const selection = useMemo(
    () =>
      resolveMapSelection(
        { person: search.person, devices: search.devices },
        available,
        complete,
        search.view === "heat",
      ),
    [search.person, search.devices, available, complete, search.view],
  );
  const selected = selection.selected;
  const selectedKey = selected?.key ?? null;
  // Heat is one's own: with someone else selected the page shows Live, and Heat again with Me.
  const heatOffered = selectedKey === null || selectedKey === me;
  const view = shownView(search.view, heatOffered);

  // A link from before the single selection (`?segment=`, `?devices=`) implies a person: write
  // it into the address once the lists are in, so that closing a move or ticking all devices
  // again keeps their detail instead of falling back to the overview.
  useEffect(() => {
    // A person the link names is adopted at once; one implied by its devices once the lists say whose.
    if (selectedKey !== null && (complete || search.person !== null)) adoptPerson(selectedKey);
  }, [complete, search.person, selectedKey, adoptPerson]);

  // Heat frames the camera only when the page opened on it; Live and History frame anew with what they draw.
  const [openedOn] = useState(view);
  const [leftFirstView, setLeftFirstView] = useState(false);
  if (!leftFirstView && view !== openedOn) setLeftFirstView(true);

  const everyone = people.data ?? [];
  const shared = {
    selection,
    devices,
    people: everyone,
    colors,
    personColors,
    level,
    dark: mapStyle.dark,
    today,
    timeZone: user.timezone,
  };
  const live = useLiveView({
    ...shared,
    active: view === "live",
    now,
    thresholds,
  });
  const history = useHistoryView({
    ...shared,
    active: view === "history",
    period: search.period,
    showDay,
    showRange,
  });
  const heat = useHeatView({
    active: view === "heat",
    selection,
    devices,
    viewport,
    framesCamera: openedOn === "heat" && !leftFirstView,
    dark: mapStyle.dark,
    today,
  });
  const content = view === "live" ? live : view === "history" ? history : heat;

  // Where the selected person has been: Live's today (a day back is History), History's day or
  // period. Heat draws nobody else.
  const period = search.period;
  const wherePeriod: WhereTheyveBeenPeriod | null =
    view === "live"
      ? { day: today, from: today, to: today, today, onDay: showHistoryDay, opensHistory: true }
      : view === "history"
        ? {
            day: period.mode === "day" ? period.from : null,
            from: period.from,
            to: period.to,
            today,
            onDay: period.mode === "day" ? showDay : null,
            opensHistory: false,
          }
        : null;

  // Beside the map the panel scrolls by itself: another view or person starts at its top.
  const panel = useRef<HTMLElement | null>(null);
  const focusRef = usePanelFocus(
    selectedKey,
    available.some((person) => person.key === selectedKey),
  );
  const panelRef = useCallback(
    (element: HTMLElement | null) => {
      panel.current = element;
      focusRef(element);
      return scrollable(element);
    },
    [scrollable, focusRef],
  );
  const toTop = () => {
    if (panel.current !== null) panel.current.scrollTop = 0;
  };
  const switchView = (next: MapView) => {
    toTop();
    setView(next);
  };
  const [params] = useSearchParams();
  const linkTo = (person: string) => `?${withPerson(params, person).toString()}`;
  const backTo = `?${withPerson(params, null).toString()}`;

  // Devices to choose among, when there are several: the selected person's; in Heat one's own,
  // whoever is selected (nobody's else is offered there). Choosing some selects Me (adoptPerson).
  const filtered = view === "heat" ? available.find((person) => person.key === me) : selected;
  const groups: DeviceFilterGroup[] =
    filtered === undefined || filtered === null || filtered.devices.length < 2
      ? []
      : [
          {
            key: filtered.key,
            name: filtered.name,
            devices: filtered.devices.map((device) =>
              filtered.key === me
                ? { ...device, slot: colors.slot(device.id), palette: "device" as const }
                : { ...device, slot: personColors.slot(filtered.key), palette: "person" as const },
            ),
          },
        ];
  const deviceCount = groups.reduce((sum, group) => sum + group.devices.length, 0);
  const shownCount = groups.reduce(
    (sum, group) =>
      sum + group.devices.filter((device) => selection.filter?.includes(device.id) ?? true).length,
    0,
  );
  const transport = content.transport;
  const summary = [
    // Which devices draw only matters when some do not.
    ...(deviceCount > 1 && shownCount < deviceCount
      ? [`${shownCount} of ${deviceCount} devices`]
      : []),
    ...(transport === null ? [] : [levelLabels[level]]),
    `${mapStyleLabels[mapStyle.choice]} map`,
  ].join(" · ");

  // The view's part of the list and of every detail, with the label that names it.
  const viewPanel =
    content.panel === null ? null : (
      <section className="map-page__details" aria-label={content.panelLabel}>
        {content.panel}
      </section>
    );

  return (
    <div className="map-page">
      <DocumentTitle title={`${content.title} · People`} />
      <section className="map-page__panel" aria-labelledby="people-page-title" ref={panelRef}>
        <div className="map-page__top">
          <PageHeader
            title="People"
            titleId="people-page-title"
            description={content.description}
            actions={
              // Not while the list is known to be empty: the card says so and has the button.
              people.isSuccess && everyone.length === 0 ? undefined : (
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
              )
            }
          />
          {sharing.offlineReason}
          <ViewSwitch view={view} views={viewsFor(heatOffered)} onChange={switchView} />
        </div>
        <div className="map-page__head">
          {content.controls === null ? null : (
            <div className="map-page__controls">{content.controls}</div>
          )}
          <MapOptions summary={summary}>
            <MapStyleControl
              choice={mapStyle.choice}
              choices={mapStyle.choices}
              onChange={mapStyle.setChoice}
            />
            {transport === null ? null : (
              <div className="map-page__level">
                <p className="map-options__label" aria-hidden="true">
                  Detail of the tracks
                </p>
                <LevelControl level={level} available={transport.available} onChange={setLevel} />
              </div>
            )}
            {deviceCount > 1 ? (
              <details className="disclosure map-page__advanced" open={filterOpen || undefined}>
                <summary>
                  <Icon name="chevronDown" className="disclosure__chevron" />
                  <span>Advanced</span>
                </summary>
                <DeviceFilter groups={groups} selected={selection.filter} onChange={setDevices} />
              </details>
            ) : null}
          </MapOptions>
          {transport !== null && level === "inferred" ? (
            <ModeLegend
              modes={transport.modes}
              review={transport.review}
              stopPaths={transport.stopPaths}
              gaps={transport.gaps}
            />
          ) : null}
        </div>

        <div className="map-page__map">
          <div className="map-page__canvas">
            {mapStyle.style === null ? null : (
              <LazyTrailMap
                {...content.map}
                mapStyle={mapStyle.style}
                dark={mapStyle.dark}
                notice={mapStyle.notice}
                onViewChange={setViewport}
                // Two fingers move a map inside a scrolling page; beside the panel one is enough.
                cooperativeGestures={!wide}
              />
            )}
            {content.chip}
          </div>
          {content.foot === null ? null : <div className="map-page__foot">{content.foot}</div>}
        </div>

        <div className="map-page__body">
          {selectedKey === null ? (
            <PeopleList
              people={people}
              devices={devices}
              personColors={personColors}
              now={now}
              thresholds={thresholds}
              linkTo={linkTo}
              panel={viewPanel}
              sharing={sharing}
            />
          ) : (
            <PersonPanel
              selected={selectedKey}
              backTo={backTo}
              name={user.displayName}
              devices={devices}
              people={people}
              personColors={personColors}
              now={now}
              thresholds={thresholds}
              content={content}
              period={wherePeriod}
              sharing={sharing}
              onLeave={leavePerson}
            />
          )}
        </div>
      </section>
      {sharing.dialogs}
      {content.dialog}
    </div>
  );
}
