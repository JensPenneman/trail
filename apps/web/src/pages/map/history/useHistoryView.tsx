import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { Person } from "@trail/contracts/person";
import type { ProcessingLevel } from "@trail/contracts/transport";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { DeviceColors } from "../../../devices/useDeviceColors";
import { useFormatter } from "../../../format/useFormatter";
import { boundsOf } from "../../../map/boundsOf";
import type { MapPoint } from "../../../map/mapTypes";
import { tracksToMap } from "../../../map/tracksToMap";
import { sharesHistory } from "../../../people/sharesHistory";
import type { PersonColors } from "../../../people/usePersonColors";
import { useDays } from "../../../queries/useDays";
import { usePersonDays } from "../../../queries/usePersonDays";
import { usePersonTracks } from "../../../queries/usePersonTracks";
import { useTimeline } from "../../../queries/useTimeline";
import { useTracks } from "../../../queries/useTracks";
import { useTrips } from "../../../queries/useTrips";
import { useVisits } from "../../../queries/useVisits";
import { addDays } from "../../../time/addDays";
import { boundedRange } from "../../../time/boundedRange";
import { shiftMonth } from "../../../time/shiftMonth";
import { useNow } from "../../../time/useNow";
import { DayTimeline } from "../../../transport/DayTimeline";
import { SegmentDialog } from "../../../transport/SegmentDialog";
import { transportModeInfo } from "../../../transport/transportModes";
import { useTransportMap } from "../../../transport/useTransportMap";
import { Button } from "../../../ui/Button";
import { EmptyState } from "../../../ui/EmptyState";
import { ErrorState } from "../../../ui/ErrorState";
import { LoadingBlock } from "../../../ui/LoadingBlock";
import { Skeleton } from "../../../ui/Skeleton";
import { Spinner } from "../../../ui/Spinner";
import { useMediaQuery } from "../../../ui/useMediaQuery";
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
import { atText, momentOf } from "./parseAt";
import {
  dayBounds,
  dayOf,
  endOf,
  movesOf,
  movingStretches,
  type NowEntry,
  NowStrip,
  PlayerBar,
  quietIntervals,
  splitTime,
  usePlaybackAnnouncer,
  usePlaybackDays,
  usePlaybackPrefetch,
  usePlayerEngine,
  usePlayerKeys,
  usePlayerState,
} from "./playback";
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
  /** The slider's moment from the address, `YYYY-MM-DDTHH:MM`, if it has one. */
  at: string | null;
  /** The slider's moment, written to the address once it stops moving. */
  setAt: (at: string) => void;
  /** Where playback paused, ended or was left: a day and a moment on it. */
  showMoment: (day: string, at: string) => void;
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
  period: urlPeriod,
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
  at,
  setAt,
  showMoment,
}: HistoryViewInput): MapViewContent {
  const format = useFormatter();
  // The player lives up here: the day it plays replaces the address's period before the queries
  // below run, and what it knows of the data comes from those queries afterwards (`world`).
  const player = usePlayerState();
  const playback = player.state;
  const playing = playback.status !== "off";
  const period = useMemo<MapSearch["period"]>(
    () => (playing ? { mode: "day", from: playback.day, to: playback.day } : urlPeriod),
    [playing, playback.day, urlPeriod],
  );
  // What the map draws after the cursor is dimmed; rounded, so the tracks are cut four times a
  // second at most however often the clock moves.
  const until = playing ? splitTime(playback.clock, playback.rate) : undefined;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The slider reaches to now, rounded to the minute, on today.
  const nowS = Math.floor(useNow(60_000) / 60_000) * 60;
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
  const rawTracks = useMemo(
    () => tracksToMap(trackList, colors.hex, until),
    [trackList, colors, until],
  );
  const transport = useTransportMap(range, level, rawTracks, { dark, device: colors.hex }, until);
  const peopleTracks = useMemo(
    () =>
      theirs.flatMap(({ userId, track }) =>
        tracksToMap([track], () => personColors.hex(userId), until),
      ),
    [theirs, personColors, until],
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
        // A visit the cursor has not reached is dimmed, like the track ahead.
        ...(until !== undefined && Date.parse(visit.arrivedAt ?? visit.recordedAt) / 1000 > until
          ? { dimmed: true as const }
          : {}),
      })),
    [visitList, colors, until],
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

  // The slider spans the day (or the days of the period) from midnight to the next midnight — on
  // today to now — and starts at the latest recorded point; playing, it is the clock.
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
  const sliderSpan = useMemo(() => {
    const first = dayBounds(period.from, timeZone).start;
    const last = dayBounds(period.to, timeZone).end;
    const reach = period.to === today ? Math.max(first + 60, Math.min(last, nowS)) : last;
    // What was recorded is within it (a clock a little ahead of the server's, a late upload).
    return { start: first, end: span === null ? reach : Math.max(reach, span.end) };
  }, [period.from, period.to, today, timeZone, nowS, span]);
  const atMoment = momentOf(at, timeZone);
  const startValue =
    atMoment !== null && atMoment >= sliderSpan.start && atMoment <= sliderSpan.end
      ? atMoment
      : (span?.end ?? sliderSpan.end);
  const scrubValue = playing
    ? playback.clock
    : Math.min(
        sliderSpan.end,
        Math.max(sliderSpan.start, scrub?.key === periodKey ? scrub.value : startValue),
      );
  // The slider's moment is written to the address once it has stopped moving for a moment.
  useEffect(() => {
    if (!active || playing || scrub === null || scrub.key !== periodKey) return undefined;
    const text = atText(scrubValue, timeZone);
    if (text === at) return undefined;
    const timer = setTimeout(() => setAt(text), 400);
    return () => clearTimeout(timer);
  }, [active, playing, scrub, periodKey, scrubValue, timeZone, at, setAt]);
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

  // Playback. Who can be played: oneself, or someone whose share includes history.
  const playable = selected !== null && (meSelected || (other !== null && sharesHistory(other)));
  const personDays = usePersonDays(
    playing && other !== null && sharesHistory(other) ? other.userId : null,
    today,
  );
  const playDays = usePlaybackDays({
    active: active && playing,
    startDay: playback.startDay,
    playingDay: playback.day,
    today,
    source: meSelected
      ? { kind: "me", deviceIds: own?.deviceIds ?? null }
      : { kind: "person", days: personDays },
  });
  // The playing day is loaded once what its moves and quiet stretches are made from is in:
  // its tracks, and for one's own the timeline and the level's tracks (placeholder data is the
  // previous day's).
  const playingLoaded =
    playing &&
    (meSelected
      ? range !== null &&
        !tracks.isPending &&
        !tracks.isPlaceholderData &&
        !timeline.isPending &&
        !timeline.isPlaceholderData &&
        !transport.pending
      : requests.length > 0 && !personTracks.pending);
  const moves = useMemo(
    () =>
      meSelected && segments !== undefined && !timeline.isPlaceholderData
        ? movesOf(segments)
        : movingStretches(allTracks.map((track) => track.points)),
    [meSelected, segments, timeline.isPlaceholderData, allTracks],
  );
  const quiet = useMemo(() => {
    const bounds = dayBounds(period.from, timeZone);
    return quietIntervals({ from: bounds.start, to: bounds.end }, moves);
  }, [period.from, timeZone, moves]);
  const lastDay = playDays.days.at(-1) ?? null;
  const guessedEnd = useMemo(() => {
    const times = [...playDays.lastAt.values()];
    return times.length === 0 ? null : Math.max(...times);
  }, [playDays.lastAt]);
  const finalDayLast = playingLoaded && playback.day === lastDay && span !== null ? span.end : null;
  const end = endOf(guessedEnd, finalDayLast, playDays.complete);
  usePlayerEngine(player, {
    reducedMotion,
    world: {
      timeZone,
      days: playDays.days,
      daysComplete: playDays.complete,
      moves,
      quiet,
      loaded: (day) => day === playback.day && playingLoaded,
      end,
    },
  });
  usePlayerKeys(player);
  usePlaybackAnnouncer(playback);
  usePlaybackPrefetch({
    active: active && playing,
    day: playback.day,
    clock: playback.clock,
    days: playDays.days,
    timeZone,
    level,
    moves,
    skipStops: playback.skipStops,
    me: meSelected ? { deviceIds: own?.deviceIds ?? null } : null,
    personRequest:
      other === null
        ? null
        : (range) => personTrackRequests([other], selection.devicesOf, range)[0] ?? null,
  });
  // A day whose tracks come back empty (the days endpoint counts points the track drops, as too
  // inaccurate) has nothing to play: on to the next day with data.
  const nextWithData = playDays.days.find((candidate) => candidate > playback.day) ?? null;
  useEffect(() => {
    if (playback.status !== "playing" || !playingLoaded || allTracks.length > 0) return;
    if (nextWithData !== null) player.controls.seek(dayBounds(nextWithData, timeZone).start);
  }, [playback.status, playingLoaded, allTracks.length, nextWithData, timeZone, player.controls]);
  // Changing view or person ends playback without writing the address (a hook does not unmount).
  const startedOn = useRef<string | null>(null);
  const silentExit = useRef(false);
  const selectedKey = selected?.key ?? null;
  useEffect(() => {
    if (!playing) {
      startedOn.current = null;
      return;
    }
    startedOn.current ??= selectedKey ?? "";
    if (!active || startedOn.current !== (selectedKey ?? "")) {
      silentExit.current = true;
      player.controls.exit();
    }
  }, [playing, active, selectedKey, player.controls]);
  // Pausing, reaching the end and leaving write the day and the moment (in place of the entry);
  // nothing is written while it plays.
  const was = useRef({ status: playback.status, day: playback.day, clock: playback.clock });
  useEffect(() => {
    const before = was.current;
    const ran = before.status === "playing" || before.status === "loading";
    if (playback.status !== "off")
      was.current = { status: playback.status, day: playback.day, clock: playback.clock };
    else was.current = { ...before, status: "off" };
    const stopped =
      playback.status === "paused" || playback.status === "ended" || playback.status === "off";
    if (!ran || !stopped) return;
    if (silentExit.current) {
      silentExit.current = false;
      return;
    }
    // Where it stopped: the state it stopped in, or, once it is off, the last one it was in.
    const stoppedAt = playback.status === "off" ? before : playback;
    setScrub({
      key: `${stoppedAt.day}|${stoppedAt.day}|${selected?.key ?? "everyone"}|${own?.deviceIds?.join(",") ?? "all"}`,
      value: stoppedAt.clock,
    });
    showMoment(stoppedAt.day, atText(stoppedAt.clock, timeZone));
  }, [playback.status, playback.day, playback.clock, timeZone, showMoment, selected, own]);
  // What each drawn device was doing at the moment shown, for the strip that replaces the sidebar.
  const nowEntries = useMemo<NowEntry[]>(
    () =>
      readouts.map((readout) => {
        const during = meSelected
          ? (segments ?? []).find(
              (segment) =>
                segment.deviceId === readout.deviceId &&
                Date.parse(segment.startedAt) / 1000 <= scrubValue &&
                scrubValue < Date.parse(segment.endedAt) / 1000,
            )
          : undefined;
        return {
          id: readout.deviceId,
          name: readout.name,
          slot: readout.slot,
          palette: readout.palette,
          mode:
            during === undefined
              ? null
              : during.kind === "stop"
                ? "Stop"
                : transportModeInfo[during.mode ?? "unknown"].label,
          speed: readout.position?.speed ?? null,
          position:
            readout.position === null
              ? null
              : { lat: readout.position.lat, lon: readout.position.lon },
        };
      }),
    [readouts, meSelected, segments, scrubValue],
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
        start={sliderSpan.start}
        end={sliderSpan.end}
        value={scrubValue}
        withDate={withDate}
        readouts={readouts}
        onChange={(value) => setScrub({ key: periodKey, value })}
        {...(playable
          ? {
              onPlay: () =>
                player.controls.enter(dayOf(scrubValue, timeZone), Math.round(scrubValue)),
            }
          : {})}
      />
    );
  const bar = (
    <PlayerBar
      status={playback.status === "off" ? "paused" : playback.status}
      clock={playback.clock}
      start={playback.start}
      end={end}
      latest={guessedEnd}
      rate={playback.rate}
      skipStops={playback.skipStops}
      onToggle={player.controls.toggle}
      onPreviousMove={() => player.controls.stepMove(-1)}
      onNextMove={() => player.controls.stepMove(1)}
      onRate={player.controls.setRate}
      onSkipStops={player.controls.setSkipStops}
      onSeek={player.controls.seek}
      onExit={player.controls.exit}
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
      // While playing, the camera follows the cursor once it leaves the viewport.
      ...(playing && cursors[0] !== undefined
        ? { follow: { lon: cursors[0].lon, lat: cursors[0].lat } }
        : {}),
    },
    controls: playing ? null : (
      <HistoryControls
        selection={{ ...urlPeriod, deviceIds: own?.deviceIds ?? null }}
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
    foot: playing ? (
      bar
    ) : personError === null && notice === null && scrubber === null ? null : (
      <>
        {personError}
        {notice}
        {scrubber}
      </>
    ),
    player: playing ? { on: true, strip: <NowStrip entries={nowEntries} /> } : null,
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
