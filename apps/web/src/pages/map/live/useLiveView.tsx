import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { type DeviceStatus, deviceStatus } from "@trail/contracts/deviceStatus";
import type { Person, SharedDevice } from "@trail/contracts/person";
import type { OutgoingShare } from "@trail/contracts/share";
import type { ProcessingLevel } from "@trail/contracts/transport";
import { useId, useMemo, useRef, useState } from "react";
import type { DeviceColors } from "../../../devices/useDeviceColors";
import { useFormatter } from "../../../format/useFormatter";
import { boundsOf } from "../../../map/boundsOf";
import type { MapPosition } from "../../../map/mapTypes";
import { tracksToMap } from "../../../map/tracksToMap";
import { PersonCard } from "../../../people/PersonCard";
import { personPositions } from "../../../people/personPositions";
import type { PersonColors } from "../../../people/usePersonColors";
import { useActivity } from "../../../queries/useActivity";
import { useHidePerson } from "../../../queries/useHidePerson";
import { usePersonTracks } from "../../../queries/usePersonTracks";
import { useShares } from "../../../queries/useShares";
import { useTimeline } from "../../../queries/useTimeline";
import { useTracks } from "../../../queries/useTracks";
import { ShareDialog, type ShareDialogMode } from "../../../sharing/ShareDialog";
import { localDayRange } from "../../../time/localDayRange";
import { SegmentDialog } from "../../../transport/SegmentDialog";
import { useTransportMap } from "../../../transport/useTransportMap";
import { EmptyState } from "../../../ui/EmptyState";
import { ErrorState } from "../../../ui/ErrorState";
import { LinkButton } from "../../../ui/LinkButton";
import { LoadingBlock } from "../../../ui/LoadingBlock";
import { PlainList } from "../../../ui/PlainList";
import { Skeleton } from "../../../ui/Skeleton";
import { useAnnounce } from "../../../ui/useAnnounce";
import { fitKey } from "../fitKey";
import { inactiveView, type MapViewContent } from "../MapViewContent";
import { me } from "../me";
import { personTrackRequests } from "../personTrackRequests";
import type { MapSelection } from "../resolveMapSelection";
import { activitySlots } from "./activitySlots";
import { DeviceCard } from "./DeviceCard";
import { LiveSummary } from "./LiveSummary";
import { UploadFeed } from "./UploadFeed";
import "./LiveView.css";

const activityHours = 48;
const activity48h = { hours: activityHours, deviceIds: null };
/** How close "Show on map" goes, by what the share reveals. */
const focusZoom = { precise: 16, approximate: 14, area: 11 } as const;

const sharesBackWith = (person: Person, shares: readonly OutgoingShare[]): boolean =>
  shares.some(
    (share) => share.recipient.userId === person.userId || share.recipient.email === person.email,
  );

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
  /** Brings the map into view where it scrolls with the page (phones). */
  revealMap: () => void;
}

/**
 * Live, the proof screen: where every device is right now, today's tracks,
 * and whether data is still arriving — updated live from the event stream —
 * with the people chosen beside them, as their shares allow. Asks for nothing
 * while another view is shown.
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
  revealMap,
}: LiveViewInput): MapViewContent {
  const format = useFormatter();
  const devicesHeadingId = useId();
  const peopleHeadingId = useId();
  const announce = useAnnounce();
  const hide = useHidePerson();
  const shares = useShares({ enabled: active && people.length > 0 });
  const [openSegment, setOpenSegment] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ShareDialogMode | null>(null);
  const [focus, setFocus] = useState<{
    key: string;
    lon: number;
    lat: number;
    zoom: number;
  } | null>(null);
  // Every "show" is a camera move of its own, even to someone shown before.
  const focusCount = useRef(0);

  const own = selection.own;
  const day = useMemo(() => localDayRange(today, today, timeZone), [today, timeZone]);
  const range = useMemo(
    () => (!active || own === null ? null : { ...day, deviceIds: own.deviceIds }),
    [active, own, day],
  );
  const tracks = useTracks(range);
  const timeline = useTimeline(level === "inferred" ? range : null);
  const activity = useActivity(range === null ? null : activity48h);
  // A query switched off can still hand out the data it had: nothing of it is shown then.
  const trackList = range === null ? undefined : tracks.data?.tracks;
  const requests = useMemo(
    () => (active ? personTrackRequests(people, selection.devicesOf, day) : []),
    [active, people, selection, day],
  );
  const personTracks = usePersonTracks(requests);

  const shown = useMemo(
    () =>
      own === null
        ? []
        : (devices.data ?? []).filter(
            (device) => own.deviceIds === null || own.deviceIds.includes(device.id),
          ),
    [devices.data, own],
  );
  const statuses = useMemo(() => {
    const map = new Map<string, DeviceStatus>();
    for (const device of shown) {
      map.set(device.id, deviceStatus(device.lastSeenAt, new Date(now), thresholds));
    }
    return map;
  }, [shown, now, thresholds]);

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
                live: statuses.get(device.id) === "live",
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
    [shown, colors, statuses, people, selection, personColors, now, thresholds],
  );
  const bounds = useMemo(
    () =>
      boundsOf([
        ...transport.tracks.flatMap((track) => track.segments.flat()),
        ...transport.transport.flatMap((segment) => segment.line),
        ...peopleTracks.flatMap((track) => track.segments.flat()),
        ...positions.map((position) => [position.lon, position.lat] as const),
      ]),
    [transport, peopleTracks, positions],
  );

  if (!active) return inactiveView;

  const meShown = selection.people.some((person) => person.key === me);
  const allDevices = devices.data ?? [];
  const distanceByDevice = new Map(
    (trackList ?? []).map((track) => [track.deviceId, track.distanceM]),
  );
  const located = [
    ...shown.filter((device) => device.lastLocation !== null).map((device) => device.name),
    ...people
      .filter((person) =>
        person.devices.some(
          (device) =>
            device.location !== null && selection.devicesOf(person.userId).includes(device.id),
        ),
      )
      .map((person) => person.displayName),
  ];
  const deviceName = (deviceId: string) =>
    shown.length > 1 ? (shown.find((device) => device.id === deviceId)?.name ?? null) : null;
  const showOnMap = (person: Person, device: SharedDevice) => {
    if (device.location === null) return;
    focusCount.current += 1;
    setFocus({
      key: `${device.id}#${focusCount.current}`,
      lon: device.location.lon,
      lat: device.location.lat,
      zoom: focusZoom[person.share.precision],
    });
    revealMap();
    announce(`The map shows ${person.displayName}.`);
  };

  return {
    title: "Live",
    description: <LiveSummary devices={shown} statuses={statuses} today={today} />,
    map: {
      label:
        located.length === 0
          ? "Map. Nobody shown has reported a position yet."
          : `Map of today’s tracks and the latest position of ${format.list(located)}. The same details are listed in the cards.`,
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
    panelLabel: people.length === 0 ? "Devices and uploads" : "Devices, people and uploads",
    panel: (
      <>
        {meShown ? (
          <section className="section" aria-labelledby={devicesHeadingId}>
            <h2
              className={people.length === 0 ? "visually-hidden" : "section__title"}
              id={devicesHeadingId}
            >
              {people.length === 0 ? "Devices" : "Your devices"}
            </h2>
            {devices.isPending ? (
              <LoadingBlock label="Loading devices">
                <Skeleton height="14rem" />
                <Skeleton height="14rem" />
              </LoadingBlock>
            ) : devices.isError ? (
              <ErrorState
                title="Devices could not be loaded"
                error={devices.error}
                onRetry={() => void devices.refetch()}
                retrying={devices.isFetching}
              />
            ) : allDevices.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon="devices"
                  title="Connect your first phone"
                  action={
                    <LinkButton to="/devices?add=1" variant="primary" icon="plus">
                      Add a device
                    </LinkButton>
                  }
                >
                  <p>
                    Trail shows your phones here as soon as Overland sends its first points. Adding
                    one takes a minute: give it a name, scan the code with the iPhone camera, done.
                  </p>
                </EmptyState>
              </div>
            ) : (
              <PlainList className="live-view__cards">
                {shown.map((device) => (
                  <li key={device.id}>
                    <DeviceCard
                      device={device}
                      status={statuses.get(device.id) ?? "never"}
                      thresholds={thresholds}
                      colorSlot={colors.slot(device.id)}
                      distanceTodayM={
                        tracks.isPending ? null : (distanceByDevice.get(device.id) ?? 0)
                      }
                      activity={
                        activity.data === undefined
                          ? null
                          : activitySlots(
                              activity.data.buckets,
                              device.id,
                              activity.data.to,
                              activityHours,
                            )
                      }
                      now={now}
                    />
                  </li>
                ))}
              </PlainList>
            )}
            {tracks.isError ? (
              <ErrorState
                title="Today’s tracks could not be loaded"
                error={tracks.error}
                onRetry={() => void tracks.refetch()}
                retrying={tracks.isFetching}
              />
            ) : null}
          </section>
        ) : null}

        {people.length === 0 ? null : (
          <section className="section" aria-labelledby={peopleHeadingId}>
            <h2 className="section__title" id={peopleHeadingId}>
              People
            </h2>
            <PlainList className="live-view__cards">
              {people.map((person) => (
                <li key={person.userId}>
                  <PersonCard
                    person={person}
                    colorSlot={personColors.slot(person.userId)}
                    now={now}
                    liveMinutes={thresholds.liveMinutes}
                    sharesBack={sharesBackWith(person, shares.data ?? [])}
                    onShowOnMap={(device) => showOnMap(person, device)}
                    onShareBack={() => setSharing({ kind: "create", email: person.email })}
                    hiding={hide.isPending && hide.variables.shareId === person.share.id}
                    onHide={() =>
                      hide.mutate(
                        { shareId: person.share.id, hidden: true },
                        {
                          onSuccess: () =>
                            announce(`${person.displayName} is hidden. Show them again on People.`),
                        },
                      )
                    }
                  />
                </li>
              ))}
            </PlainList>
            {hide.isError ? <ErrorState title="Nobody was hidden" error={hide.error} /> : null}
            {personTracks.error === null ? null : (
              <ErrorState
                title="Today’s tracks of people could not be loaded"
                error={personTracks.error}
              />
            )}
          </section>
        )}

        {meShown && shown.length > 0 ? <UploadFeed devices={shown} slotOf={colors.slot} /> : null}
      </>
    ),
    dialog: (
      <>
        {shownSegment === null ? null : (
          <SegmentDialog
            segment={shownSegment}
            deviceName={deviceName(shownSegment.deviceId)}
            onClose={() => setOpenSegment(null)}
          />
        )}
        <ShareDialog mode={sharing} onClose={() => setSharing(null)} suggestions={[]} />
      </>
    ),
  };
}
