import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import type { ProcessingLevel } from "@trail/contracts/transport";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { DeviceColors } from "../../../devices/useDeviceColors";
import { useFormatter } from "../../../format/useFormatter";
import { boundsOf } from "../../../map/boundsOf";
import type { MapPoint } from "../../../map/mapTypes";
import { tracksToMap } from "../../../map/tracksToMap";
import { sharesHistory } from "../../../people/sharesHistory";
import type { PersonColors } from "../../../people/usePersonColors";
import { useDays } from "../../../queries/useDays";
import { usePersonTracks } from "../../../queries/usePersonTracks";
import { useTimeline } from "../../../queries/useTimeline";
import { useTracks } from "../../../queries/useTracks";
import { useTrips } from "../../../queries/useTrips";
import { useVisits } from "../../../queries/useVisits";
import { addDays } from "../../../time/addDays";
import { boundedRange } from "../../../time/boundedRange";
import { shiftMonth } from "../../../time/shiftMonth";
import { DayTimeline } from "../../../transport/DayTimeline";
import { SegmentDialog } from "../../../transport/SegmentDialog";
import { useTransportMap } from "../../../transport/useTransportMap";
import { Button } from "../../../ui/Button";
import { EmptyState } from "../../../ui/EmptyState";
import { ErrorState } from "../../../ui/ErrorState";
import { LoadingBlock } from "../../../ui/LoadingBlock";
import { Skeleton } from "../../../ui/Skeleton";
import { Spinner } from "../../../ui/Spinner";
import { fitKey } from "../fitKey";
import { inactiveView, type MapViewContent } from "../MapViewContent";
import { withPerson } from "../mapSearchUpdates";
import { me } from "../me";
import type { MapSearch } from "../parseMapSearch";
import { personTrackRequests } from "../personTrackRequests";
import { personTrackStates } from "../personTrackStates";
import type { MapSelection } from "../resolveMapSelection";
import { HistoryControls } from "./HistoryControls";
import { type CalendarDay, MonthCalendar } from "./MonthCalendar";
import { PeriodSummary } from "./PeriodSummary";
import { positionAt } from "./positionAt";
import { type ScrubberReadout, TimeScrubber } from "./TimeScrubber";
import { TripList } from "./TripList";
import { VisitList } from "./VisitList";

export interface HistoryViewInput {
  active: boolean;
  period: MapSearch["period"];
  selection: MapSelection;
  devices: UseQueryResult<DeviceSummary[]>;
  /** Everyone who shares with the signed-in person. */
  people: readonly Person[];
  /** Device and person colours for the map's background. */
  colors: DeviceColors;
  personColors: PersonColors;
  level: ProcessingLevel;
  dark: boolean;
  today: string;
  timeZone: string;
  showDay: (date: string) => void;
  showRange: (from: string, to: string) => void;
}

type Focus = { key: string; lon: number; lat: number; zoom: number };

/**
 * History: where the devices have been, a day or a period of tracks at a level
 * of calculation, with a time slider and totals, all driven by the URL. The
 * overview draws one's own tracks and those of everyone whose share includes
 * history; selecting someone shows theirs alone, and their detail says what they
 * share of it (`personTracks`). Levels, the timeline, visits and trips are one's
 * own, so they are there only while Me is selected. Asks for nothing while
 * another view is shown.
 */
export function useHistoryView({
  active,
  period,
  selection,
  devices,
  people,
  colors,
  personColors,
  level,
  dark,
  today,
  timeZone,
  showDay,
  showRange,
}: HistoryViewInput): MapViewContent {
  const format = useFormatter();
  const calendarId = useId();
  const [openSegment, setOpenSegment] = useState<string | null>(null);
  // A link to one move (`&segment=<id>`, Insights' "Show on the map") opens its details
  // once the day's timeline has it; closing them drops the parameter.
  const [params, setParams] = useSearchParams();
  const selected = selection.selected;
  const meSelected = selected?.key === me;
  const other =
    selected === null || meSelected
      ? null
      : (people.find((person) => person.userId === selected.key) ?? null);
  // One's own tracks are drawn in the overview and for Me; the rest is Me's alone.
  const drawsOwn = selected === null || meSelected;
  const linkedSegment = active && meSelected ? params.get("segment") : null;
  const closeSegment = () => {
    setOpenSegment(null);
    if (linkedSegment === null) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("segment");
        return next;
      },
      { replace: true },
    );
  };
  // A move clicked on the map in the overview opens in Me's detail, where the timeline is.
  const openFromMap = (id: string) => {
    if (meSelected) setOpenSegment(id);
    else
      setParams((current) => {
        const next = withPerson(current, me);
        next.set("segment", id);
        return next;
      });
  };
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Opened from the panel's empty state (a sheet on phones): focus goes into the calendar.
  const [fromPanel, setFromPanel] = useState(false);
  const [browsing, setBrowsing] = useState<{ anchor: string; month: string } | null>(null);
  const [scrub, setScrub] = useState<{ key: string; value: number } | null>(null);
  // A camera move belongs to its period: another day — from the controls, a person's detail or
  // the history's Back — drops it, and it is never made again.
  const [focus, setFocus] = useState<(Focus & { period: string }) | null>(null);
  // Every "show" is a camera move of its own, even to a place shown before.
  const focusCount = useRef(0);
  const focusOn = (target: Omit<Focus, "key">, what: string) => {
    focusCount.current += 1;
    setFocus({ ...target, key: `${what}#${focusCount.current}`, period: periodKey });
  };

  const own = selection.own;
  const withDate = period.mode === "range";
  const bounded = useMemo(
    () => boundedRange(period.from, period.to, timeZone),
    [period.from, period.to, timeZone],
  );
  const range = useMemo(
    () => (!active || !drawsOwn || own === null ? null : { ...bounded, deviceIds: own.deviceIds }),
    [active, drawsOwn, own, bounded],
  );
  // Visits, trips and the timeline load only with Me selected; the overview skips them.
  const mineRange = meSelected ? range : null;
  const drawnPeople = useMemo(
    () => (meSelected ? [] : other !== null ? [other] : selected === null ? people : []),
    [meSelected, other, selected, people],
  );
  const requests = useMemo(
    () => (active ? personTrackRequests(drawnPeople, selection.devicesOf, bounded) : []),
    [active, drawnPeople, selection, bounded],
  );
  const personTracks = usePersonTracks(requests);
  const trackStates = useMemo(
    () => personTrackStates(requests, personTracks),
    [requests, personTracks],
  );
  const periodKey = `${period.from}|${period.to}|${selected?.key ?? "everyone"}|${own?.deviceIds?.join(",") ?? "all"}`;
  const tracks = useTracks(range);
  const visits = useVisits(mineRange);
  const trips = useTrips(mineRange);
  const timeline = useTimeline(mineRange);

  // The calendar follows the shown day unless the person browses to another month.
  const calendarMonth =
    browsing !== null && browsing.anchor === period.from ? browsing.month : period.from;
  const monthStart = `${calendarMonth.slice(0, 7)}-01`;
  const days = useDays(
    range === null
      ? null
      : {
          from: monthStart,
          to: addDays(shiftMonth(monthStart, 1), -1),
          deviceIds: range.deviceIds,
        },
  );
  const calendarDays = useMemo(() => {
    const byDate = new Map<string, CalendarDay>();
    for (const day of days.data?.days ?? []) {
      if (day.points === 0) continue;
      const current = byDate.get(day.date) ?? { points: 0, slots: [] };
      byDate.set(day.date, {
        points: current.points + day.points,
        slots: [...current.slots, colors.slot(day.deviceId)].sort((a, b) => a - b),
      });
    }
    return byDate;
  }, [days.data, colors]);

  const deviceList = devices.data ?? [];
  // A query switched off can still hand out the data it had: nothing of it is shown then.
  const trackList = useMemo(
    () =>
      range === null ? [] : (tracks.data?.tracks ?? []).filter((track) => track.points.length > 0),
    [range, tracks.data],
  );
  // Other people's devices, each with whose it is.
  const theirs = useMemo(
    () =>
      requests.flatMap((request, index) =>
        (personTracks.data[index]?.tracks ?? [])
          .filter((track) => track.points.length > 0)
          .map((track) => ({ userId: request.userId, track })),
      ),
    [requests, personTracks.data],
  );
  const visitList = mineRange === null ? undefined : visits.data;
  const rawTracks = useMemo(() => tracksToMap(trackList, colors.hex), [trackList, colors]);
  const transport = useTransportMap(range, level, rawTracks, { dark, device: colors.hex });
  const peopleTracks = useMemo(
    () =>
      theirs.flatMap(({ userId, track }) => tracksToMap([track], () => personColors.hex(userId))),
    [theirs, personColors],
  );
  const owners = useMemo(() => {
    const byDevice = new Map<string, { person: Person; name: string }>();
    for (const person of people) {
      for (const device of person.devices) byDevice.set(device.id, { person, name: device.name });
    }
    return byDevice;
  }, [people]);
  const segments = mineRange === null ? undefined : timeline.data?.items;
  const shownSegment =
    segments?.find((segment) => segment.id === (openSegment ?? linkedSegment)) ?? null;
  const visitPoints = useMemo<MapPoint[]>(
    () =>
      (visitList ?? []).map((visit) => ({
        id: `${visit.deviceId}:${visit.recordedAt}`,
        color: colors.hex(visit.deviceId),
        lon: visit.lon,
        lat: visit.lat,
      })),
    [visitList, colors],
  );
  const bounds = useMemo(
    () =>
      boundsOf([
        ...transport.tracks.flatMap((track) => track.segments.flat()),
        ...transport.transport.flatMap((segment) => segment.line),
        ...peopleTracks.flatMap((track) => track.segments.flat()),
        ...visitPoints.map((point) => [point.lon, point.lat] as const),
      ]),
    [transport, peopleTracks, visitPoints],
  );

  // The slider spans the recorded time of the period; it starts at the latest point.
  const allTracks = useMemo(
    () => [...trackList, ...theirs.map(({ track }) => track)],
    [trackList, theirs],
  );
  const span = useMemo(() => {
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const track of allTracks) {
      const first = track.points[0];
      const last = track.points[track.points.length - 1];
      if (first !== undefined && first[2] < start) start = first[2];
      if (last !== undefined && last[2] > end) end = last[2];
    }
    return Number.isFinite(start) ? { start, end } : null;
  }, [allTracks]);
  const scrubValue =
    span === null
      ? 0
      : Math.min(span.end, Math.max(span.start, scrub?.key === periodKey ? scrub.value : span.end));
  const readouts = useMemo<ScrubberReadout[]>(
    () => [
      ...trackList.map((track) => ({
        deviceId: track.deviceId,
        name: deviceList.find((device) => device.id === track.deviceId)?.name ?? "Removed device",
        slot: colors.slot(track.deviceId),
        palette: "device" as const,
        position: positionAt(track.points, scrubValue),
      })),
      ...theirs.map(({ userId, track }) => ({
        deviceId: track.deviceId,
        name: owners.get(track.deviceId)?.name ?? "Shared device",
        slot: personColors.slot(userId),
        palette: "person" as const,
        position: positionAt(track.points, scrubValue),
      })),
    ],
    [trackList, theirs, deviceList, owners, colors, personColors, scrubValue],
  );
  const cursors = useMemo<MapPoint[]>(
    () =>
      readouts.flatMap((readout) =>
        readout.position === null
          ? []
          : [
              {
                id: readout.deviceId,
                color:
                  readout.palette === "person"
                    ? personColors.hex(owners.get(readout.deviceId)?.person.userId ?? "")
                    : colors.hex(readout.deviceId),
                lon: readout.position.lon,
                lat: readout.position.lat,
              },
            ],
      ),
    [readouts, colors, personColors, owners],
  );

  // Another day drops it, so that coming back to its day does not make it again either, and
  // so does another view, so that History shown again does not.
  if (focus !== null && (!active || focus.period !== periodKey)) setFocus(null);
  if (!active) return inactiveView;

  // The devices really drawn: one's own while their tracks are, and those of the people asked for.
  const shownIds = [
    ...(drawsOwn && own !== null
      ? deviceList
          .filter((device) => own.deviceIds === null || own.deviceIds.includes(device.id))
          .map((device) => device.id)
      : []),
    ...requests.flatMap((request) => request.deviceIds),
  ];
  const periodLabel =
    period.mode === "day"
      ? format.dayLong(period.from)
      : `${format.day(period.from)} – ${format.day(period.to)}`;
  const hasData = allTracks.length > 0;
  const withHistory = drawnPeople.filter(sharesHistory);
  const nameOf = (deviceId: string) => {
    const shared = owners.get(deviceId);
    if (shared !== undefined) return `${shared.person.displayName} · ${shared.name}`;
    return deviceList.find((device) => device.id === deviceId)?.name ?? "Removed device";
  };
  const swatchOf = (deviceId: string) => {
    const shared = owners.get(deviceId);
    return shared === undefined
      ? { slot: colors.slot(deviceId), palette: "device" as const }
      : { slot: personColors.slot(shared.person.userId), palette: "person" as const };
  };
  const deviceName = (deviceId: string) =>
    deviceList.length > 1
      ? (deviceList.find((device) => device.id === deviceId)?.name ?? "Removed device")
      : null;
  const day = period.mode === "day" ? period.from : null;

  // Their tracks, device by device: Me's group of it, and the one of someone else's page.
  const summary =
    range !== null && tracks.isPending ? (
      <LoadingBlock label="Loading tracks">
        <Skeleton height="1.5rem" width="40%" />
        <Skeleton height="4.5rem" />
      </LoadingBlock>
    ) : hasData ? (
      <PeriodSummary
        untitled
        tracks={allTracks}
        nameOf={nameOf}
        swatchOf={swatchOf}
        withDate={withDate}
      />
    ) : null;
  const nothingRecorded =
    period.mode === "day"
      ? `Nothing recorded on ${format.day(period.from)}`
      : "Nothing recorded in this period";
  // At the map's foot, where the day's slider would be: why there is nothing to scrub.
  const personError =
    personTracks.error === null ? null : (
      <ErrorState title="Tracks of people could not be loaded" error={personTracks.error} />
    );
  let notice: ReactNode = null;
  if (range !== null && tracks.isError) {
    notice = (
      <ErrorState
        title="Tracks could not be loaded"
        error={tracks.error}
        onRetry={() => void tracks.refetch()}
        retrying={tracks.isFetching}
      />
    );
  } else if (!(range !== null && tracks.isPending) && !hasData) {
    if (drawsOwn) {
      notice = (
        <div className="card">
          <EmptyState
            icon="history"
            title={nothingRecorded}
            action={
              period.mode === "day" && !calendarOpen ? (
                <Button
                  icon="calendar"
                  onClick={() => {
                    setFromPanel(true);
                    setCalendarOpen(true);
                  }}
                >
                  Find a day with data
                </Button>
              ) : undefined
            }
          >
            <p>
              Days with points have a dot in the calendar. Points with an accuracy worse than 200 m
              are left out of tracks.
            </p>
          </EmptyState>
        </div>
      );
    } else if (withHistory.length > 0 && !personTracks.pending) {
      // Someone else alone: their tracks, or their page says why there are none.
      notice = (
        <div className="card">
          <EmptyState icon="history" title={nothingRecorded}>
            <p>
              Only what {format.list(withHistory.map((person) => person.displayName))}{" "}
              {withHistory.length === 1 ? "shares" : "share"} with you appears here.
            </p>
          </EmptyState>
        </div>
      );
    }
  }
  const scrubber =
    span === null ? null : (
      <TimeScrubber
        start={span.start}
        end={span.end}
        value={scrubValue}
        withDate={withDate}
        readouts={readouts}
        onChange={(value) => setScrub({ key: periodKey, value })}
      />
    );

  return {
    title: "History",
    map: {
      label: hasData
        ? meSelected
          ? `Map of the tracks for ${periodLabel}. The timeline, visits and trips are on your page.`
          : selected === null
            ? `Map of the tracks for ${periodLabel}.`
            : `Map of ${other?.displayName ?? "their"}’s tracks for ${periodLabel}. Their totals are on their page.`
        : drawsOwn
          ? `Map. Nothing was recorded for ${periodLabel}.`
          : `Map. Nothing to show for ${periodLabel}.`,
      tracks: [...transport.tracks, ...peopleTracks],
      transport: transport.transport,
      selectedSegmentId: shownSegment?.id ?? null,
      onSegmentClick: openFromMap,
      visits: visitPoints,
      cursors,
      fit: {
        key: fitKey(`${period.from}..${period.to}`, selected?.key ?? null, shownIds),
        // Tracks placeholder data belongs to the previous period until the new one arrives.
        bounds:
          devices.isPending ||
          (range !== null && (tracks.isPending || tracks.isPlaceholderData)) ||
          (mineRange !== null && visits.isPending) ||
          transport.pending ||
          personTracks.pending
            ? null
            : bounds,
        maxZoom: 16,
      },
      focus: focus !== null && focus.period === periodKey ? focus : null,
    },
    controls: (
      <HistoryControls
        selection={{ ...period, deviceIds: own?.deviceIds ?? null }}
        today={today}
        onDay={(date) => {
          showDay(date);
          setFocus(null);
        }}
        onRange={(from, to) => {
          showRange(from, to);
          setFocus(null);
        }}
        open={calendarOpen}
        onOpenChange={(open) => {
          setCalendarOpen(open);
          if (!open) setFromPanel(false);
        }}
        focusIn={fromPanel}
        calendar={(done) => (
          <MonthCalendar
            id={calendarId}
            month={calendarMonth}
            onMonthChange={(month) => setBrowsing({ anchor: period.from, month })}
            selected={period.from}
            today={today}
            days={calendarDays}
            loading={days.isFetching}
            onSelect={(date) => {
              showDay(date);
              setFocus(null);
              done();
            }}
          />
        )}
      />
    ),
    transport: drawsOwn ? transport : null,
    chip:
      (tracks.isFetching && !tracks.isPending) ||
      (transport.fetching && !transport.pending) ||
      (personTracks.fetching && !personTracks.pending) ? (
        <p className="map-page__chip" aria-hidden="true">
          <Spinner size="s" /> Updating
        </p>
      ) : null,
    legend: null,
    // What there is to say of the day or period besides the slider: nothing recorded, or an error.
    foot:
      personError === null && notice === null && scrubber === null ? null : (
        <>
          {personError}
          {notice}
          {scrubber}
        </>
      ),
    timelineLabel: "",
    timeline: !meSelected ? null : (
      <DayTimeline
        regionLabel="Timeline"
        segments={segments}
        pending={timeline.data?.pending ?? false}
        loading={timeline.isPending}
        error={timeline.isError ? timeline.error : null}
        onRetry={() => void timeline.refetch()}
        deviceName={deviceName}
        day={day}
        onOpen={(segment) => {
          setOpenSegment(segment.id);
          focusOn(
            { lon: segment.centroid.lon, lat: segment.centroid.lat, zoom: 13 },
            `segment:${segment.id}`,
          );
        }}
      />
    ),
    meGroupTitle: "Summary, visits and trips",
    meGroup: !meSelected ? null : (
      <>
        {summary}

        <VisitList
          visits={visitList}
          loading={visits.isPending}
          error={visits.isError ? visits.error : null}
          onRetry={() => void visits.refetch()}
          devices={deviceList}
          slotOf={colors.slot}
          day={day}
          onShow={(visit) => {
            focusOn({ lon: visit.lon, lat: visit.lat, zoom: 15 }, `visit:${visit.recordedAt}`);
            const arrived = visit.arrivedAt ?? visit.recordedAt;
            setScrub({ key: periodKey, value: Math.floor(Date.parse(arrived) / 1000) });
          }}
        />

        <TripList
          trips={mineRange === null ? undefined : trips.data}
          loading={trips.isPending}
          error={trips.isError ? trips.error : null}
          onRetry={() => void trips.refetch()}
          devices={deviceList}
          slotOf={colors.slot}
          day={day}
          onShow={(trip) => {
            const time = Math.floor(Date.parse(trip.startedAt) / 1000);
            setScrub({ key: periodKey, value: time });
            const track = trackList.find((candidate) => candidate.deviceId === trip.deviceId);
            const position = track === undefined ? null : positionAt(track.points, time);
            if (position !== null) {
              focusOn({ lon: position.lon, lat: position.lat, zoom: 14 }, `trip:${trip.startedAt}`);
            }
          }}
        />
      </>
    ),
    personGroup: meSelected || selected === null ? null : summary,
    personTracks: trackStates,
    dialog:
      shownSegment === null ? null : (
        <SegmentDialog
          segment={shownSegment}
          deviceName={deviceName(shownSegment.deviceId)}
          onClose={closeSegment}
        />
      ),
  };
}
