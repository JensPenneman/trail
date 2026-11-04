import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { deviceStatus } from "@trail/contracts/deviceStatus";
import type { Person } from "@trail/contracts/person";
import type { ProcessingLevel } from "@trail/contracts/transport";
import { useCallback, useMemo, useRef, useState } from "react";
import type { DeviceColors } from "../../../devices/useDeviceColors";
import { useFormatter } from "../../../format/useFormatter";
import { liveWindowOpen } from "../../../live/liveWindowOpen";
import { useLiveState } from "../../../live/useLiveState";
import { boundsOf } from "../../../map/boundsOf";
import type { MapPosition } from "../../../map/mapTypes";
import { positionExtent } from "../../../map/positionExtent";
import { tracksToMap } from "../../../map/tracksToMap";
import { personPositions } from "../../../people/personPositions";
import type { PersonColors } from "../../../people/usePersonColors";
import { usePersonTracks } from "../../../queries/usePersonTracks";
import { useTimeline } from "../../../queries/useTimeline";
import { useTracks } from "../../../queries/useTracks";
import { localDayRange } from "../../../time/localDayRange";
import { DayTimeline } from "../../../transport/DayTimeline";
import { SegmentDialog } from "../../../transport/SegmentDialog";
import { useTransportMap } from "../../../transport/useTransportMap";
import { ErrorState } from "../../../ui/ErrorState";
import { fitKey } from "../fitKey";
import { inactiveView, type MapViewContent } from "../MapViewContent";
import { me } from "../me";
import { personTrackRequests } from "../personTrackRequests";
import { personTrackStates } from "../personTrackStates";
import type { MapSelection } from "../resolveMapSelection";

export interface LiveViewInput {
  active: boolean;
  selection: MapSelection;
  devices: UseQueryResult<DeviceSummary[]>;
  /** Everyone who shares with the signed-in person: their positions are always on the map. */
  people: readonly Person[];
  /** Device and person colours for the map's background. */
  colors: DeviceColors;
  personColors: PersonColors;
  level: ProcessingLevel;
  dark: boolean;
  today: string;
  timeZone: string;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
}

type Focus = { key: string; lon: number; lat: number; zoom: number };

/**
 * Live: where everyone is right now, from the event stream, as their shares
 * allow — the overview draws positions only and asks for no track at all.
 * Selecting Me adds today's own track at the chosen level and one's day so far
 * (the timeline of stops and moves); selecting someone else adds their track
 * for today, in their colour. Asks for nothing while another view is shown.
 */
export function useLiveView({
  active,
  selection,
  devices,
  people,
  colors,
  personColors,
  level,
  dark,
  today,
  timeZone,
  now,
  thresholds,
}: LiveViewInput): MapViewContent {
  const format = useFormatter();
  const [openSegment, setOpenSegment] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  // Every "show" is a camera move of its own, even to a place shown before.
  const focusCount = useRef(0);

  const selected = selection.selected;
  const meSelected = selected?.key === me;
  const other =
    selected === null || meSelected
      ? null
      : (people.find((p) => p.userId === selected.key) ?? null);
  const own = selection.own;
  const { connection } = useLiveState();
  // A marker pulses only while what it shows may be called live (liveWindowOpen).
  const windowOpen = liveWindowOpen(connection, devices.dataUpdatedAt, now, thresholds.liveMinutes);
  const day = useMemo(() => localDayRange(today, today, timeZone), [today, timeZone]);
  // Nobody's track is drawn in the overview: no range, no request (docs/architecture.md §14).
  const range = useMemo(
    () => (!active || !meSelected || own === null ? null : { ...day, deviceIds: own.deviceIds }),
    [active, meSelected, own, day],
  );
  const tracks = useTracks(range);
  // Today's stops and moves: one's day so far, and the lines at Transport.
  const timeline = useTimeline(range);
  // A query switched off can still hand out the data it had: nothing of it is shown then.
  const trackList = range === null ? undefined : tracks.data?.tracks;
  const requests = useMemo(
    () => (active && other !== null ? personTrackRequests([other], selection.devicesOf, day) : []),
    [active, other, selection, day],
  );
  const personTracks = usePersonTracks(requests);
  const trackStates = useMemo(
    () => personTrackStates(requests, personTracks),
    [requests, personTracks],
  );

  // Everyone's position stays on the map, whoever is selected.
  const ownDevices = useMemo(
    () => (devices.data ?? []).filter((device) => selection.devicesOf(me).includes(device.id)),
    [devices.data, selection],
  );

  const rawTracks = useMemo(() => tracksToMap(trackList ?? [], colors.hex), [trackList, colors]);
  const transport = useTransportMap(range, level, rawTracks, { dark, device: colors.hex });
  const peopleTracks = useMemo(
    () =>
      requests.flatMap((request, index) =>
        tracksToMap(personTracks.data[index]?.tracks ?? [], () => personColors.hex(request.userId)),
      ),
    [requests, personTracks.data, personColors],
  );
  const segments = range === null ? undefined : timeline.data?.items;
  const shownSegment = segments?.find((segment) => segment.id === openSegment) ?? null;
  const isLive = useCallback(
    (recordedAt: string) => now - Date.parse(recordedAt) <= thresholds.liveMinutes * 60_000,
    [now, thresholds],
  );
  const ownPositions = useMemo<MapPosition[]>(
    () =>
      ownDevices.flatMap((device) =>
        device.lastLocation === null
          ? []
          : [
              {
                id: device.id,
                color: colors.hex(device.id),
                slot: colors.slot(device.id),
                lon: device.lastLocation.lon,
                lat: device.lastLocation.lat,
                accuracy: device.lastLocation.accuracy,
                live:
                  windowOpen &&
                  deviceStatus(device.lastSeenAt, new Date(now), thresholds) === "live",
              },
            ],
      ),
    [ownDevices, colors, now, thresholds, windowOpen],
  );
  const peoplePositions = useMemo(
    () => personPositions(people, selection.devicesOf, personColors, isLive),
    [people, selection, personColors, isLive],
  );
  const positions = useMemo(
    () => [...ownPositions, ...peoplePositions],
    [ownPositions, peoplePositions],
  );
  // The overview frames everybody; a selection frames that person, their track and positions.
  const framed = useMemo(
    () =>
      selected === null
        ? positions
        : meSelected
          ? ownPositions
          : personPositions(
              people.filter((person) => person.userId === selected.key),
              selection.devicesOf,
              personColors,
              isLive,
            ),
    [selected, meSelected, positions, ownPositions, people, selection, personColors, isLive],
  );
  const bounds = useMemo(
    () =>
      boundsOf([
        ...transport.tracks.flatMap((track) => track.segments.flat()),
        ...transport.transport.flatMap((segment) => segment.line),
        ...peopleTracks.flatMap((track) => track.segments.flat()),
        // A coarse share's whole circle: its centre alone would pass for an exact spot.
        ...framed.flatMap(positionExtent),
      ]),
    [transport, peopleTracks, framed],
  );

  // A camera move belongs to the moment it was asked for: back in Live, it is not made again.
  if (!active && focus !== null) setFocus(null);
  if (!active) return inactiveView;

  const allDevices = devices.data ?? [];
  const peopleLocated = people
    .filter((person) =>
      person.devices.some(
        (device) =>
          device.location !== null && selection.devicesOf(person.userId).includes(device.id),
      ),
    )
    .map((person) => person.displayName);
  const mineLocated = ownDevices.some((device) => device.lastLocation !== null);
  const everyone = [...(mineLocated ? ["you"] : []), ...peopleLocated];
  const deviceName = (deviceId: string) =>
    ownDevices.length > 1
      ? (ownDevices.find((device) => device.id === deviceId)?.name ?? null)
      : null;

  const whereTheyAre = everyone.length === 0 ? null : format.list(everyone);
  // Promise a track only when one is drawn: a live-only share or a quiet day has none.
  const trackDrawn = meSelected
    ? transport.tracks.length + transport.transport.length > 0
    : peopleTracks.length > 0;
  const label =
    whereTheyAre === null
      ? "Map. Nobody shown has reported a position yet."
      : selected === null || !trackDrawn
        ? `Map of where everyone is now: ${whereTheyAre}.`
        : `Map of ${meSelected ? "your track" : `${other?.displayName ?? "their"}’s track`} today and where everyone is now: ${whereTheyAre}.`;

  return {
    title: "Live",
    map: {
      label,
      tracks: [...transport.tracks, ...peopleTracks],
      transport: transport.transport,
      selectedSegmentId: shownSegment?.id ?? null,
      onSegmentClick: setOpenSegment,
      positions,
      // Framed once both the positions and the selected person's track are known, never on partial data.
      fit: {
        key: fitKey("live", selected?.key ?? null, [
          ...ownDevices.map((device) => device.id),
          ...people.flatMap((person) => selection.devicesOf(person.userId)),
        ]),
        bounds:
          devices.isPending ||
          (range !== null && tracks.isPending) ||
          transport.pending ||
          personTracks.pending
            ? null
            : bounds,
        maxZoom: 15,
      },
      focus,
    },
    controls: null,
    transport: !meSelected || allDevices.length === 0 ? null : transport,
    chip: null,
    legend: null,
    foot: null,
    timelineLabel: "Your day so far",
    timeline:
      !meSelected || allDevices.length === 0 ? null : (
        <>
          {tracks.isError ? (
            <ErrorState
              title="Today’s tracks could not be loaded"
              error={tracks.error}
              onRetry={() => void tracks.refetch()}
              retrying={tracks.isFetching}
            />
          ) : null}
          {range === null ? null : (
            <DayTimeline
              regionLabel="Timeline"
              segments={segments}
              pending={timeline.data?.pending ?? false}
              loading={timeline.isPending}
              error={timeline.isError ? timeline.error : null}
              onRetry={() => void timeline.refetch()}
              deviceName={deviceName}
              day={today}
              onOpen={(segment) => {
                setOpenSegment(segment.id);
                focusCount.current += 1;
                setFocus({
                  lon: segment.centroid.lon,
                  lat: segment.centroid.lat,
                  zoom: 13,
                  key: `segment:${segment.id}#${focusCount.current}`,
                });
              }}
            />
          )}
        </>
      ),
    meGroup: null,
    meGroupTitle: "",
    personGroup: null,
    personTracks: trackStates,
    dialog:
      shownSegment === null ? null : (
        <SegmentDialog
          segment={shownSegment}
          deviceName={deviceName(shownSegment.deviceId)}
          onClose={() => setOpenSegment(null)}
        />
      ),
  };
}
