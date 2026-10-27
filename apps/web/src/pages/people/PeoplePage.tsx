import type { Person, SharedDevice } from "@trail/contracts/person";
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
import { useAnnounce } from "../../ui/useAnnounce";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { DeviceFilter, type DeviceFilterGroup } from "../map/DeviceFilter";
import { useHeatView } from "../map/heat/useHeatView";
import { useHistoryView } from "../map/history/useHistoryView";
import { useLiveView } from "../map/live/useLiveView";
import { MapOptions } from "../map/MapOptions";
import type { MapPerson } from "../map/MapPerson";
import { MapStyleControl } from "../map/MapStyleControl";
import { type MapView, shownView, viewsFor } from "../map/mapViews";
import { me } from "../map/me";
import { PersonSelector } from "../map/PersonSelector";
import { resolveMapSelection } from "../map/resolveMapSelection";
import { useMapSearch } from "../map/useMapSearch";
import { ViewSwitch } from "../map/ViewSwitch";
import { MeCard } from "./MeCard";
import { PeopleList } from "./PeopleList";
import { everyoneToggled, selectionShowing } from "./peopleSelection";
import "./PeoplePage.css";

const defaultThresholds = { liveMinutes: 15, staleHours: 12 };
/** Where the map sits beside the panel instead of inside the scrolling page. */
const besideThePanel = "(min-width: 64rem)";
/** How close "Show on map" goes for someone the map shows already, by what their share reveals. */
const focusZoom = { precise: 16, approximate: 14, area: 11 } as const;

type Focus = { key: string; lon: number; lat: number; zoom: number };

/**
 * The People page, Trail's home (docs/architecture.md §14): one map with its
 * three views — Live, History and Heat — and the choices they share (whose
 * data, which devices, the map style, the tracks' level), all in the URL;
 * beside it the people: Me first, then everyone who shares with the signed-in
 * person. "Show on map" on a card makes that person the map's choice, and the
 * page offers what can be shown of them: one's own levels, timeline, visits,
 * trips and heatmap only while Me is chosen. Every view keeps its state and
 * its queries in a hook that asks for nothing while another view is shown, so
 * the map itself, with its camera, stays as it is when the view changes.
 */
export function PeoplePage() {
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
  const announce = useAnnounce();
  const thresholds = config.data?.thresholds ?? defaultThresholds;
  const [viewport, setViewport] = useState<MapViewState | null>(null);

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
  const shownKeys = selection.people.map((person) => person.key);
  const meShown = shownKeys.includes(me);
  // Heat is one's own: with only others chosen the page shows Live, and Heat again with Me.
  const view = shownView(search.view, meShown);

  // Heat frames the camera only when the page opened on it; the other views share theirs.
  const [openedOn] = useState(view);
  const [leftFirstView, setLeftFirstView] = useState(false);
  if (!leftFirstView && view !== openedOn) setLeftFirstView(true);

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

  // "Show on map" for someone shown already moves the camera, over the view's last move. Once the
  // view moves it again (or another view is shown) that one is the latest, and Show on map's is done:
  // the map remembers only the last move it made, so an old one handed back would be made again.
  const [shownFocus, setShownFocus] = useState<{ focus: Focus; over: string | null } | null>(null);
  const focusCount = useRef(0);
  const viewFocus = content.map.focus ?? null;
  const viewFocusKey = viewFocus?.key ?? null;
  if (shownFocus !== null && shownFocus.over !== viewFocusKey) setShownFocus(null);
  const focus =
    shownFocus !== null && shownFocus.over === viewFocusKey ? shownFocus.focus : viewFocus;

  const devicesOf = (person: string) =>
    available.find((candidate) => candidate.key === person)?.devices.map((device) => device.id) ??
    [];
  /** Shows someone: them alone when the map does not show them yet, else the camera goes there. */
  const show = (key: string, name: string, target: Omit<Focus, "key"> | null) => {
    const next = selectionShowing(shownKeys, key);
    if (next !== null) {
      // A new choice frames itself: what the map draws for it has a camera fit of its own.
      setPeople(next, devicesOf);
    } else if (target !== null) {
      focusCount.current += 1;
      setShownFocus({
        focus: { ...target, key: `show:${key}#${focusCount.current}` },
        over: viewFocusKey,
      });
    }
    revealMap();
    announce(`The map shows ${name}.`);
  };
  const showMe = () => {
    const latest = (devices.data ?? [])
      .flatMap((device) => (device.lastLocation === null ? [] : [device.lastLocation]))
      .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];
    show(me, "you", latest === undefined ? null : { lon: latest.lon, lat: latest.lat, zoom: 15 });
  };
  const showPerson = (person: Person, device: SharedDevice) => {
    if (device.location === null) return;
    show(person.userId, person.displayName, {
      lon: device.location.lon,
      lat: device.location.lat,
      zoom: focusZoom[person.share.precision],
    });
  };
  const everyoneKeys = available.map((person) => person.key);
  const everyoneShown = everyoneKeys.every((key) => shownKeys.includes(key));
  const showEveryone = () => {
    const next = everyoneToggled(shownKeys, everyoneKeys);
    setPeople(next, devicesOf);
    revealMap();
    announce(next.length === 1 ? "The map shows you." : "The map shows everyone.");
  };

  // Beside the map the panel scrolls by itself: another view starts at its top.
  const panel = useRef<HTMLElement | null>(null);
  const panelRef = useCallback(
    (element: HTMLElement | null) => {
      panel.current = element;
      return scrollable(element);
    },
    [scrollable],
  );
  const switchView = (next: MapView) => {
    if (panel.current !== null) panel.current.scrollTop = 0;
    setView(next);
  };

  // Heatmaps are one's own: in Heat, people do not apply and the filter lists one's devices.
  const choosesPeople = available.length > 1 && view !== "heat";
  const groups: DeviceFilterGroup[] = selection.people
    .filter((person) => view !== "heat" || person.key === me)
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

  return (
    <div className="map-page">
      <DocumentTitle title={`${content.title} · People`} />
      <section className="map-page__panel" aria-labelledby="people-page-title" ref={panelRef}>
        <div className="map-page__top">
          <PageHeader
            title="People"
            titleId="people-page-title"
            description={content.description}
          />
          <ViewSwitch view={view} views={viewsFor(meShown)} onChange={switchView} />
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
                selected={shownKeys}
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
                focus={focus}
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

        <div className="map-page__body">
          {view === "live" || content.panel === null ? null : (
            <section className="map-page__details" aria-label={content.panelLabel}>
              {content.panel}
            </section>
          )}
          <MeCard
            name={user.displayName}
            devices={devices}
            now={now}
            thresholds={thresholds}
            shown={meShown}
            onShowOnMap={showMe}
          >
            {view === "live" ? content.panel : null}
          </MeCard>
          <PeopleList
            people={people}
            shown={shownKeys}
            everyone={available.length > 2 ? everyoneShown : null}
            personColors={personColors}
            now={now}
            liveMinutes={thresholds.liveMinutes}
            onShow={showPerson}
            onShowEveryone={showEveryone}
            notice={content.peopleNotice}
          />
        </div>
      </section>
      {content.dialog}
    </div>
  );
}
