import { useId, useMemo, useState } from "react";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useSessionUser } from "../../app/useSessionUser";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useFormatter } from "../../format/useFormatter";
import { boundsOf } from "../../map/boundsOf";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import type { MapPoint } from "../../map/mapTypes";
import { tracksToMap } from "../../map/tracksToMap";
import { useMapStyle } from "../../map/useMapStyle";
import { useDays } from "../../queries/useDays";
import { useDevices } from "../../queries/useDevices";
import { useTracks } from "../../queries/useTracks";
import { useTrips } from "../../queries/useTrips";
import { useVisits } from "../../queries/useVisits";
import { addDays } from "../../time/addDays";
import { boundedRange } from "../../time/boundedRange";
import { shiftMonth } from "../../time/shiftMonth";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PageHeader } from "../../ui/PageHeader";
import { Skeleton } from "../../ui/Skeleton";
import { Spinner } from "../../ui/Spinner";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { DeviceFilter } from "./DeviceFilter";
import { HistoryControls } from "./HistoryControls";
import { type CalendarDay, MonthCalendar } from "./MonthCalendar";
import { PeriodSummary } from "./PeriodSummary";
import { positionAt } from "./positionAt";
import { type ScrubberReadout, TimeScrubber } from "./TimeScrubber";
import { TripList } from "./TripList";
import { useHistorySelection } from "./useHistorySelection";
import { VisitList } from "./VisitList";
import "./HistoryPage.css";

/**
 * Where the devices have been: a day or a period of tracks, with a time
 * slider, per-device totals, visits and trips — all driven by the URL.
 */
export function HistoryPage() {
  const user = useSessionUser();
  const format = useFormatter();
  const calendarId = useId();
  const scrollable = useScrollableFocus();
  const { selection, today, showDay, showRange, showDevices } = useHistorySelection();
  const devices = useDevices();
  const colors = useDeviceColors();
  const { styleUrl, dark } = useMapStyle();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [browsing, setBrowsing] = useState<{ anchor: string; month: string } | null>(null);
  const [scrub, setScrub] = useState<{ key: string; value: number } | null>(null);
  const [focus, setFocus] = useState<{
    key: string;
    lon: number;
    lat: number;
    zoom: number;
  } | null>(null);

  const withDate = selection.mode === "range";
  const range = useMemo(
    () => ({
      ...boundedRange(selection.from, selection.to, user.timezone),
      deviceIds: selection.deviceIds,
    }),
    [selection.from, selection.to, selection.deviceIds, user.timezone],
  );
  const periodKey = `${range.from}|${range.to}|${range.deviceIds?.join(",") ?? "all"}`;
  const tracks = useTracks(range);
  const visits = useVisits(range);
  const trips = useTrips(range);

  // The calendar follows the shown day unless the person browses to another month.
  const calendarMonth =
    browsing !== null && browsing.anchor === selection.from ? browsing.month : selection.from;
  const monthStart = `${calendarMonth.slice(0, 7)}-01`;
  const days = useDays({
    from: monthStart,
    to: addDays(shiftMonth(monthStart, 1), -1),
    deviceIds: selection.deviceIds,
  });
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
  const trackList = useMemo(
    () => (tracks.data?.tracks ?? []).filter((track) => track.points.length > 0),
    [tracks.data],
  );
  const mapTracks = useMemo(() => tracksToMap(trackList, colors.hex), [trackList, colors]);
  const visitPoints = useMemo<MapPoint[]>(
    () =>
      (visits.data ?? []).map((visit) => ({
        id: `${visit.deviceId}:${visit.recordedAt}`,
        color: colors.hex(visit.deviceId),
        lon: visit.lon,
        lat: visit.lat,
      })),
    [visits.data, colors],
  );
  const bounds = useMemo(
    () =>
      boundsOf([
        ...mapTracks.flatMap((track) => track.segments.flat()),
        ...visitPoints.map((point) => [point.lon, point.lat] as const),
      ]),
    [mapTracks, visitPoints],
  );

  // The slider spans the recorded time of the period; it starts at the latest point.
  const span = useMemo(() => {
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const track of trackList) {
      const first = track.points[0];
      const last = track.points[track.points.length - 1];
      if (first !== undefined && first[2] < start) start = first[2];
      if (last !== undefined && last[2] > end) end = last[2];
    }
    return Number.isFinite(start) ? { start, end } : null;
  }, [trackList]);
  const scrubValue =
    span === null
      ? 0
      : Math.min(span.end, Math.max(span.start, scrub?.key === periodKey ? scrub.value : span.end));
  const readouts = useMemo<ScrubberReadout[]>(
    () =>
      trackList.map((track) => ({
        deviceId: track.deviceId,
        name: deviceList.find((device) => device.id === track.deviceId)?.name ?? "Removed device",
        slot: colors.slot(track.deviceId),
        position: positionAt(track.points, scrubValue),
      })),
    [trackList, deviceList, colors, scrubValue],
  );
  const cursors = useMemo<MapPoint[]>(
    () =>
      readouts.flatMap((readout) =>
        readout.position === null
          ? []
          : [
              {
                id: readout.deviceId,
                color: colors.hex(readout.deviceId),
                lon: readout.position.lon,
                lat: readout.position.lat,
              },
            ],
      ),
    [readouts, colors],
  );

  const periodLabel =
    selection.mode === "day"
      ? format.dayLong(selection.from)
      : `${format.day(selection.from)} – ${format.day(selection.to)}`;
  const hasData = trackList.length > 0;
  const mapLabel = hasData
    ? `Map of the tracks for ${periodLabel}. Totals, visits and trips are listed on this page.`
    : `Map. Nothing was recorded for ${periodLabel}.`;

  return (
    <div className="map-layout history-page">
      <DocumentTitle title="History" />
      <div className="map-layout__head history-page__head">
        <PageHeader
          title="History"
          description={selection.mode === "range" ? periodLabel : undefined}
        />
        <HistoryControls
          selection={selection}
          today={today}
          onDay={(date) => {
            showDay(date);
            setFocus(null);
          }}
          onRange={(from, to) => {
            showRange(from, to);
            setCalendarOpen(false);
            setFocus(null);
          }}
          calendarId={calendarId}
          calendarOpen={calendarOpen && selection.mode === "day"}
          onToggleCalendar={() => setCalendarOpen((open) => !open)}
        />
        {calendarOpen && selection.mode === "day" ? (
          <MonthCalendar
            id={calendarId}
            month={calendarMonth}
            onMonthChange={(month) => setBrowsing({ anchor: selection.from, month })}
            selected={selection.from}
            today={today}
            days={calendarDays}
            loading={days.isFetching}
            onSelect={(date) => {
              showDay(date);
              setFocus(null);
            }}
          />
        ) : null}
      </div>

      <div className="map-layout__map history-page__map-area">
        <div className="history-page__map">
          {styleUrl === null ? null : (
            <LazyTrailMap
              label={mapLabel}
              styleUrl={styleUrl}
              dark={dark}
              tracks={mapTracks}
              visits={visitPoints}
              cursors={cursors}
              fit={{
                key: periodKey,
                // Tracks placeholder data belongs to the previous period until the new one arrives.
                bounds:
                  tracks.isPending || tracks.isPlaceholderData || visits.isPending ? null : bounds,
                maxZoom: 16,
              }}
              focus={focus}
              cooperativeGestures
            />
          )}
          {tracks.isFetching && !tracks.isPending ? (
            <p className="map-layout__chip" aria-hidden="true">
              <Spinner size="s" /> Updating
            </p>
          ) : null}
        </div>
        {span === null ? null : (
          <div className="history-page__scrubber">
            <TimeScrubber
              start={span.start}
              end={span.end}
              value={scrubValue}
              withDate={withDate}
              readouts={readouts}
              onChange={(value) => setScrub({ key: periodKey, value })}
            />
          </div>
        )}
      </div>

      {/* Beside the map on wide screens this panel scrolls by itself. */}
      <section className="map-layout__body" aria-label="Totals, visits and trips" ref={scrollable}>
        {deviceList.length > 1 ? (
          <DeviceFilter
            devices={deviceList}
            selected={selection.deviceIds}
            slotOf={colors.slot}
            onChange={showDevices}
          />
        ) : null}
        {tracks.isPending ? (
          <LoadingBlock label="Loading tracks">
            <Skeleton height="1.5rem" width="40%" />
            <Skeleton height="4.5rem" />
          </LoadingBlock>
        ) : tracks.isError ? (
          <ErrorState
            title="Tracks could not be loaded"
            error={tracks.error}
            onRetry={() => void tracks.refetch()}
            retrying={tracks.isFetching}
          />
        ) : hasData ? (
          <PeriodSummary
            tracks={trackList}
            devices={deviceList}
            slotOf={colors.slot}
            withDate={withDate}
          />
        ) : (
          <div className="card">
            <EmptyState
              icon="history"
              title={
                selection.mode === "day"
                  ? `Nothing recorded on ${format.day(selection.from)}`
                  : "Nothing recorded in this period"
              }
              action={
                selection.mode === "day" && !calendarOpen ? (
                  <Button icon="calendar" onClick={() => setCalendarOpen(true)}>
                    Find a day with data
                  </Button>
                ) : undefined
              }
            >
              <p>
                Days with points have a dot in the calendar. Points with an accuracy worse than 200
                m are left out of tracks.
              </p>
            </EmptyState>
          </div>
        )}

        <VisitList
          visits={visits.data}
          loading={visits.isPending}
          error={visits.isError ? visits.error : null}
          onRetry={() => void visits.refetch()}
          devices={deviceList}
          slotOf={colors.slot}
          day={selection.mode === "day" ? selection.from : null}
          onShow={(visit) => {
            setFocus({
              key: `${visit.deviceId}:${visit.recordedAt}`,
              lon: visit.lon,
              lat: visit.lat,
              zoom: 15,
            });
            const arrived = visit.arrivedAt ?? visit.recordedAt;
            setScrub({ key: periodKey, value: Math.floor(Date.parse(arrived) / 1000) });
          }}
        />

        <TripList
          trips={trips.data}
          loading={trips.isPending}
          error={trips.isError ? trips.error : null}
          onRetry={() => void trips.refetch()}
          devices={deviceList}
          slotOf={colors.slot}
          day={selection.mode === "day" ? selection.from : null}
          onShow={(trip) => {
            const time = Math.floor(Date.parse(trip.startedAt) / 1000);
            setScrub({ key: periodKey, value: time });
            const track = trackList.find((candidate) => candidate.deviceId === trip.deviceId);
            const position = track === undefined ? null : positionAt(track.points, time);
            if (position !== null) {
              setFocus({
                key: `trip:${trip.deviceId}:${trip.startedAt}`,
                lon: position.lon,
                lat: position.lat,
                zoom: 14,
              });
            }
          }}
        />
      </section>
    </div>
  );
}
