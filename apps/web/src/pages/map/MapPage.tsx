import { useCallback, useMemo, useRef, useState } from "react";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useSessionUser } from "../../app/useSessionUser";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import { mapStyleLabels } from "../../map/mapStyleChoices";
import type { MapViewState } from "../../map/mapTypes";
import { useMapStyle } from "../../map/useMapStyle";
import { usePersonColors } from "../../people/usePersonColors";
import { useConfig } from "../../queries/useConfig";
import { useDevices } from "../../queries/useDevices";
import { usePeople } from "../../queries/usePeople";
import { useNow } from "../../time/useNow";
import { LevelControl, levelLabels } from "../../transport/LevelControl";
import { ModeLegend } from "../../transport/ModeLegend";
import { useTrackLevel } from "../../transport/useTrackLevel";
import { PageHeader } from "../../ui/PageHeader";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { DeviceFilter, type DeviceFilterGroup } from "./DeviceFilter";
import { useHeatView } from "./heat/useHeatView";
import { useHistoryView } from "./history/useHistoryView";
import { useLiveView } from "./live/useLiveView";
import { MapOptions } from "./MapOptions";
import type { MapPerson } from "./MapPerson";
import { MapStyleControl } from "./MapStyleControl";
import type { MapView } from "./mapViews";
import { me } from "./me";
import { PersonSelector } from "./PersonSelector";
import { resolveMapSelection } from "./resolveMapSelection";
import { useMapSearch } from "./useMapSearch";
import { ViewSwitch } from "./ViewSwitch";
import "./MapPage.css";

const defaultThresholds = { liveMinutes: 15, staleHours: 12 };
/** Where the map sits beside the panel instead of inside the scrolling page. */
const besideThePanel = "(min-width: 64rem)";

/**
 * The Map page (docs/architecture.md §14): one map, three views of it — Live,
 * History and Heat — and the choices they share (whose data, which devices,
 * the map style, the tracks' level), all in the URL. Every view keeps its
 * state and its queries in a hook that asks for nothing while another view is
 * shown, so the map itself, with its camera, stays as it is when the view
 * changes.
 */
export function MapPage() {
  const user = useSessionUser();
  const { search, today, setView, setPeople, setDevices, showDay, showRange } = useMapSearch();
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
  const thresholds = config.data?.thresholds ?? defaultThresholds;
  const [viewport, setViewport] = useState<MapViewState | null>(null);

  // Heat frames the camera only when the page opened on it; the other views share theirs.
  const [openedOn] = useState(search.view);
  const [leftFirstView, setLeftFirstView] = useState(false);
  if (!leftFirstView && search.view !== openedOn) setLeftFirstView(true);

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
      resolveMapSelection({ people: search.people, devices: search.devices }, available, complete),
    [search.people, search.devices, available, complete],
  );

  const shownPeople = useMemo(
    () =>
      (people.data ?? []).filter((person) =>
        selection.people.some((selected) => selected.key === person.userId),
      ),
    [people.data, selection],
  );

  // On phones the map scrolls with the page: "Show on map" brings it into view.
  const mapArea = useRef<HTMLDivElement>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const revealMap = useCallback(() => {
    if (!wide) {
      mapArea.current?.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [wide, reducedMotion]);

  const shared = {
    selection,
    devices,
    people: shownPeople,
    colors,
    personColors,
    level,
    dark: mapStyle.dark,
    today,
    timeZone: user.timezone,
  };
  const live = useLiveView({
    ...shared,
    active: search.view === "live",
    now,
    thresholds,
    revealMap,
  });
  const history = useHistoryView({
    ...shared,
    active: search.view === "history",
    period: search.period,
    showDay,
    showRange,
  });
  const heat = useHeatView({
    active: search.view === "heat",
    selection,
    devices,
    viewport,
    framesCamera: openedOn === "heat" && !leftFirstView,
    dark: mapStyle.dark,
    today,
  });
  const content = search.view === "live" ? live : search.view === "history" ? history : heat;

  // Beside the map the panel scrolls by itself: another view starts at its top.
  const panel = useRef<HTMLElement | null>(null);
  const panelRef = useCallback(
    (element: HTMLElement | null) => {
      panel.current = element;
      return scrollable(element);
    },
    [scrollable],
  );
  const switchView = (view: MapView) => {
    if (panel.current !== null) panel.current.scrollTop = 0;
    setView(view);
  };

  // Heatmaps are one's own: in Heat, people do not apply and the filter lists one's devices.
  const choosesPeople = available.length > 1 && search.view !== "heat";
  const groups: DeviceFilterGroup[] = selection.people
    .filter((person) => search.view !== "heat" || person.key === me)
    .map((person) => ({
      key: person.key,
      name: person.name,
      devices: person.devices.map((device) =>
        person.key === me
          ? { ...device, slot: colors.slot(device.id), palette: "device" as const }
          : { ...device, slot: personColors.slot(person.key), palette: "person" as const },
      ),
    }));
  const deviceCount = groups.reduce((sum, group) => sum + group.devices.length, 0);
  const shownCount = groups.reduce(
    (sum, group) =>
      sum + group.devices.filter((device) => selection.filter?.includes(device.id) ?? true).length,
    0,
  );
  const transport = content.transport;
  const summary = [
    ...(choosesPeople
      ? [
          selection.people.length === available.length
            ? "Everyone"
            : selection.people.map((person) => person.name).join(", "),
        ]
      : []),
    ...(deviceCount > 1
      ? [
          shownCount === deviceCount
            ? `All ${deviceCount} devices`
            : `${shownCount} of ${deviceCount} devices`,
        ]
      : []),
    ...(transport === null ? [] : [levelLabels[level]]),
    `${mapStyleLabels[mapStyle.choice]} map`,
  ].join(" · ");
  const devicesOf = (person: string) =>
    available.find((candidate) => candidate.key === person)?.devices.map((device) => device.id) ??
    [];

  return (
    <div className="map-page">
      <DocumentTitle title={`${content.title} · Map`} />
      <section className="map-page__panel" aria-labelledby="map-page-title" ref={panelRef}>
        <div className="map-page__top">
          <PageHeader title="Map" titleId="map-page-title" description={content.description} />
          <ViewSwitch view={search.view} onChange={switchView} />
        </div>
        <div className="map-page__head">
          {content.controls === null ? null : (
            <div className="map-page__controls">{content.controls}</div>
          )}
          <MapOptions summary={summary}>
            {choosesPeople ? (
              <PersonSelector
                people={available.map((person) => ({
                  key: person.key,
                  name: person.name,
                  slot: person.key === me ? null : personColors.slot(person.key),
                }))}
                selected={selection.people.map((person) => person.key)}
                onChange={(next) => setPeople(next, devicesOf)}
              />
            ) : null}
            {deviceCount > 1 ? (
              <DeviceFilter groups={groups} selected={selection.filter} onChange={setDevices} />
            ) : null}
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
          </MapOptions>
          {transport !== null && level === "inferred" ? (
            <ModeLegend modes={transport.modes} review={transport.review} />
          ) : null}
        </div>

        <div className="map-page__map" ref={mapArea}>
          <div className="map-page__canvas">
            {mapStyle.style === null ? null : (
              <LazyTrailMap
                {...content.map}
                mapStyle={mapStyle.style}
                dark={mapStyle.dark}
                onViewChange={setViewport}
                // Two fingers move a map inside a scrolling page; beside the panel one is enough.
                cooperativeGestures={!wide}
              />
            )}
            {content.chip}
          </div>
          {content.foot === null ? null : <div className="map-page__foot">{content.foot}</div>}
        </div>

        <section className="map-page__body" aria-label={content.panelLabel}>
          {content.panel}
        </section>
      </section>
      {content.dialog}
    </div>
  );
}
