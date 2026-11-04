import {
  type CSSProperties,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useStickyBanner } from "../../app/StickyBannerContext";
import { useSessionUser } from "../../app/useSessionUser";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import type { MapViewState } from "../../map/mapTypes";
import { useMapStyle } from "../../map/useMapStyle";
import { usePersonColors } from "../../people/usePersonColors";
import type { WhereTheyveBeenPeriod } from "../../people/WhereTheyveBeen";
import { useConfig } from "../../queries/useConfig";
import { useDevices } from "../../queries/useDevices";
import { usePeople } from "../../queries/usePeople";
import { useNow } from "../../time/useNow";
import { LevelControl } from "../../transport/LevelControl";
import { ModeLegend } from "../../transport/ModeLegend";
import { useTrackLevel } from "../../transport/useTrackLevel";
import { Icon } from "../../ui/Icon";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { DeviceFilter, type DeviceFilterGroup } from "../map/DeviceFilter";
import { useHeatView } from "../map/heat/useHeatView";
import { useHistoryView } from "../map/history/useHistoryView";
import { useLiveView } from "../map/live/useLiveView";
import { MapOptions } from "../map/MapOptions";
import { MapOverlay } from "../map/MapOverlay";
import type { MapPerson } from "../map/MapPerson";
import { MapStyleControl } from "../map/MapStyleControl";
import { withList, withPerson } from "../map/mapSearchUpdates";
import { type MapView, shownView, viewsFor } from "../map/mapViews";
import { me } from "../map/me";
import { resolveMapSelection } from "../map/resolveMapSelection";
import { useMapSearch } from "../map/useMapSearch";
import { PeoplePanel } from "./PeoplePanel";
import { usePanelFocus } from "./usePanelFocus";
import { usePeekHeight } from "./usePeekHeight";
import { useSharingActions } from "./useSharingActions";
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
  useStickyBanner();
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
  const thresholds = config.data?.thresholds ?? defaultThresholds;
  const [viewport, setViewport] = useState<MapViewState | null>(null);
  // Where the floating controls end, measured: they wrap on narrow screens.
  const [overlayEnd, setOverlayEnd] = useState(56);
  // The device filter is folded away among the map's options, and open when an address sets one.
  const [filterOpen] = useState(() => search.devices !== null);
  const sharing = useSharingActions(people.data ?? []);
  // What the people are searched for: kept here, so going to someone's page and back keeps it.
  const [query, setQuery] = useState("");

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
  // The map fits what it shows under the controls: below the bar, and left of the zoom column on
  // phones, where the bar is as wide as the map less that column.
  const fit =
    content.map.fit === undefined
      ? undefined
      : {
          ...content.map.fit,
          inset: { top: overlayEnd + 8, right: wide ? 0 : 64 },
        };

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
  // The level shown, for the focus that follows it: someone's key, `list:hidden`, or the root.
  const levelKey = selectedKey ?? (search.list === "hidden" ? "list:hidden" : null);
  const focusRef = usePanelFocus(
    levelKey,
    levelKey?.startsWith("list:") === true ||
      available.some((person) => person.key === selectedKey),
    selection.implied,
  );
  const panelRef = useCallback(
    (element: HTMLElement | null) => {
      panel.current = element;
      focusRef(element);
      return scrollable(element);
    },
    [scrollable, focusRef],
  );
  // Phones: selecting someone lifts the sheet to its half detent, where the detail reads well.
  const snaps = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const lifted = useRef(selectedKey);
  useEffect(() => {
    const before = lifted.current;
    lifted.current = selectedKey;
    if (wide || selectedKey === null || before === selectedKey) return;
    const half = snaps.current?.querySelector<HTMLElement>("[data-detent=half]");
    half?.scrollIntoView?.({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
  }, [selectedKey, wide, reducedMotion]);
  // Focus on the bar, the map or its buttons, which a lifted sheet covers: lower the sheet to its
  // peek, so what has focus can be seen (WCAG 2.4.11).
  const lowerSheet = (event: FocusEvent) => {
    if (wide || window.scrollY <= 0 || panel.current === null) return;
    // Only the keyboard (or a screen reader) is lost behind the sheet; a press on the map or a
    // button at half is the person's own placement. And only what the sheet covers.
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(":focus-visible")) return;
    // Covered when less than a target's height of it shows above the sheet (the map's canvas
    // is covered by all but a strip once the sheet is lifted to the top).
    const rect = target.getBoundingClientRect();
    const sheetTop = panel.current.getBoundingClientRect().top;
    if (Math.min(rect.bottom, sheetTop) - rect.top >= 44) return;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
  };
  const stage = useRef<HTMLDivElement | null>(null);
  const onStageFocus = useEffectEvent(lowerSheet);
  useEffect(() => {
    const element = stage.current;
    if (element === null) return undefined;
    element.addEventListener("focusin", onStageFocus);
    return () => element.removeEventListener("focusin", onStageFocus);
  }, []);
  usePeekHeight(panel, levelKey, !wide);
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
  const hiddenTo = `?${withList(params, "hidden").toString()}`;
  // Back from the Hidden list keeps what else the address says (Heat's own devices included).
  const levelBackTo = `?${withList(params, null).toString()}`;

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
  // Which devices draw only matters when some do not: it shows on the button, as the map shows less.
  const note =
    deviceCount > 1 && shownCount < deviceCount ? `${shownCount} of ${deviceCount} devices` : null;

  // The history slider: over the foot of the map beside the panel, in the sheet on phones right
  // under the Me row or the person's header (so not in the sheet's peek).
  const foot = content.foot === null ? null : <div className="map-page__foot">{content.foot}</div>;
  const options = (
    <MapOptions note={note}>
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
      {transport !== null && level === "inferred" ? (
        <ModeLegend
          modes={transport.modes}
          review={transport.review}
          stopPaths={transport.stopPaths}
          gaps={transport.gaps}
        />
      ) : null}
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
  );

  return (
    <div
      className="map-page"
      data-view={view}
      style={{ "--overlay-end": `${overlayEnd}px` } as CSSProperties}
    >
      <DocumentTitle title={`${content.title} · People`} />
      <div className="map-page__stage" ref={stage}>
        <MapOverlay
          view={view}
          views={viewsFor(heatOffered)}
          onViewChange={switchView}
          options={options}
          controls={content.controls}
          onMeasure={setOverlayEnd}
        />
        <div className="map-page__canvas">
          {mapStyle.style === null ? null : (
            <LazyTrailMap
              {...content.map}
              mapStyle={mapStyle.style}
              dark={mapStyle.dark}
              notice={mapStyle.notice}
              {...(fit === undefined ? {} : { fit })}
              onViewChange={setViewport}
              // One finger pans: on phones the page scrolls through the sheet, not the map.
              cooperativeGestures={false}
            />
          )}
          {content.chip}
        </div>
        {wide ? foot : null}
        {/* What the view says of itself, for those who cannot see the map. */}
        {content.description === null || content.description === undefined ? null : (
          <div className="visually-hidden">{content.description}</div>
        )}
      </div>

      {/* Phones: the room the map shows through; presses fall on the map under it. */}
      <div className="map-page__spacer" aria-hidden="true" />
      <div className="map-page__snaps" aria-hidden="true" ref={snaps}>
        <span className="map-page__snap map-page__snap--peek" />
        <span className="map-page__snap map-page__snap--half" data-detent="half" />
      </div>
      <PeoplePanel
        panelRef={panelRef}
        foot={wide ? null : foot}
        at={
          selectedKey !== null
            ? { level: "person", selected: selectedKey }
            : search.list === "hidden"
              ? { level: "hidden" }
              : { level: "root" }
        }
        people={people}
        devices={devices}
        personColors={personColors}
        now={now}
        thresholds={thresholds}
        linkTo={linkTo}
        hiddenTo={hiddenTo}
        backTo={backTo}
        levelBackTo={levelBackTo}
        query={query}
        onQuery={setQuery}
        name={user.displayName}
        content={content}
        period={wherePeriod}
        sharing={sharing}
        onLeave={leavePerson}
      />
      {sharing.dialogs}
      {content.dialog}
    </div>
  );
}
