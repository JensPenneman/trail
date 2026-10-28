import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { deviceStatus } from "@trail/contracts/deviceStatus";
import type { Person } from "@trail/contracts/person";
import type { ProcessingLevel } from "@trail/contracts/transport";
import { useMemo, useRef, useState } from "react";
import type { DeviceColors } from "../../../devices/useDeviceColors";
import { useFormatter } from "../../../format/useFormatter";
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
  /** The selected people who share with the signed-in person. */
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
 * Live: where everyone shown is right now and today's tracks, updated live
 * from the event stream, the people chosen as their shares allow. Its panel
 * is one's own day so far — today's timeline of stops and moves, under the Me
 * card — while the signed-in person is on the map; what proves that the
 * phones keep sending is Settings › Devices'. Asks for nothing while another
 * view is shown.
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

  const own = selection.own;
  const day = useMemo(() => localDayRange(today, today, timeZone), [today, timeZone]);
  const range = useMemo(
    () => (!active || own === null ? null : { ...day, deviceIds: own.deviceIds }),
    [active, own, day],
  );
  const tracks = useTracks(range);
  // Today's stops and moves: the timeline under the Me card, and the lines at Transport.
  const timeline = useTimeline(range);
  // A query switched off can still hand out the data it had: nothing of it is shown then.
  const trackList = range === null ? undefined : tracks.data?.tracks;
  const requests = useMemo(
    () => (active ? personTrackRequests(people, selection.devicesOf, day) : []),
    [active, people, selection, day],
  );
  const personTracks = usePersonTracks(requests);
  const trackStates = useMemo(
    () => personTrackStates(requests, personTracks),
    [requests, personTracks],
  );

  const shown = useMemo(
    () =>
      own === null
        ? []
        : (devices.data ?? []).filter(
            (device) => own.deviceIds === null || own.deviceIds.includes(device.id),
          ),
    [devices.data, own],
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
  const positions = useMemo<MapPosition[]>(
    () => [
      ...shown.flatMap((device) =>
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
                live: deviceStatus(device.lastSeenAt, new Date(now), thresholds) === "live",
              },
            ],
      ),
      ...personPositions(
        people,
        selection.devicesOf,
        personColors,
        (recordedAt) => now - Date.parse(recordedAt) <= thresholds.liveMinutes * 60_000,
      ),
    ],
    [shown, colors, people, selection, personColors, now, thresholds],
  );
  const bounds = useMemo(
    () =>
      boundsOf([
        ...transport.tracks.flatMap((track) => track.segments.flat()),
        ...transport.transport.flatMap((segment) => segment.line),
        ...peopleTracks.flatMap((track) => track.segments.flat()),
        // A coarse share's whole circle: its centre alone would pass for an exact spot.
        ...positions.flatMap(positionExtent),
      ]),
    [transport, peopleTracks, positions],
  );

  // A camera move belongs to the moment it was asked for: back in Live, it is not made again.
  if (!active && focus !== null) setFocus(null);
  if (!active) return inactiveView;

  const meShown = selection.people.some((person) => person.key === me);
  const allDevices = devices.data ?? [];
  const peopleLocated = people
    .filter((person) =>
      person.devices.some(
        (device) =>
          device.location !== null && selection.devicesOf(person.userId).includes(device.id),
      ),
    )
    .map((person) => person.displayName);
  const mineLocated = shown.some((device) => device.lastLocation !== null);
  const whose =
    peopleLocated.length === 0
      ? "your latest position"
      : mineLocated
        ? `your latest position and that of ${format.list(peopleLocated)}`
        : `the latest position of ${format.list(peopleLocated)}`;
  // Whom the view is about: you, the people chosen, or both.
  const who = [...(meShown ? ["you"] : []), ...people.map((person) => person.displayName)];
  const deviceName = (deviceId: string) =>
    shown.length > 1 ? (shown.find((device) => device.id === deviceId)?.name ?? null) : null;

  return {
    title: "Live",
    description: (
      <p>
        {who.length === 0
          ? "Where everyone is now"
          : `Where ${format.list(who)} ${who.length === 1 && who[0] !== "you" ? "is" : "are"} now`}
        {" · "}
        {format.day(today)}
      </p>
    ),
    map: {
      label:
        !mineLocated && peopleLocated.length === 0
          ? "Map. Nobody shown has reported a position yet."
          : `Map of today’s tracks and ${whose}. The same is said on the cards.`,
      tracks: [...transport.tracks, ...peopleTracks],
      transport: transport.transport,
      selectedSegmentId: shownSegment?.id ?? null,
      onSegmentClick: setOpenSegment,
      positions,
      // Framed once both the positions and today's tracks are known, never on partial data.
      fit: {
        key: fitKey(today, today, [
          ...shown.map((device) => device.id),
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
    transport: !meShown || allDevices.length === 0 ? null : transport,
    chip: null,
    foot: null,
    panelLabel: "Your day so far",
    // Right under the Me card, while the map shows the signed-in person and they have devices.
    panel:
      !meShown || allDevices.length === 0 ? null : (
        <>
          {own === null ? (
            <p className="muted">
              The device filter in Map options leaves out all of your devices.
            </p>
          ) : null}
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
