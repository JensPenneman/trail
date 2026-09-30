import { type DeviceStatus, deviceStatus } from "@trail/contracts/deviceStatus";
import { useId, useMemo } from "react";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useSessionUser } from "../../app/useSessionUser";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useFormatter } from "../../format/useFormatter";
import { boundsOf } from "../../map/boundsOf";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import type { MapPosition } from "../../map/mapTypes";
import { tracksToMap } from "../../map/tracksToMap";
import { useMapStyle } from "../../map/useMapStyle";
import { useActivity } from "../../queries/useActivity";
import { useConfig } from "../../queries/useConfig";
import { useDevices } from "../../queries/useDevices";
import { useTracks } from "../../queries/useTracks";
import { localDayRange } from "../../time/localDayRange";
import { useNow } from "../../time/useNow";
import { useToday } from "../../time/useToday";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PageHeader } from "../../ui/PageHeader";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { activitySlots } from "./activitySlots";
import { DeviceCard } from "./DeviceCard";
import { LiveSummary } from "./LiveSummary";
import { UploadFeed } from "./UploadFeed";
import "./LivePage.css";

const activityHours = 48;
const defaultThresholds = { liveMinutes: 15, staleHours: 12 };

/**
 * The proof screen: where every device is right now, today's tracks, and
 * whether data is still arriving — updated live from the event stream.
 */
export function LivePage() {
  const user = useSessionUser();
  const format = useFormatter();
  const devicesHeadingId = useId();
  const scrollable = useScrollableFocus();
  const config = useConfig();
  const devices = useDevices();
  const colors = useDeviceColors();
  const { styleUrl, dark } = useMapStyle();
  const today = useToday();
  const now = useNow(15_000);
  const thresholds = config.data?.thresholds ?? defaultThresholds;

  const range = useMemo(
    () => ({ ...localDayRange(today, today, user.timezone), deviceIds: null }),
    [today, user.timezone],
  );
  const tracks = useTracks(range);
  const activity = useActivity({ hours: activityHours, deviceIds: null });

  const deviceList = devices.data ?? [];
  const statuses = useMemo(() => {
    const map = new Map<string, DeviceStatus>();
    for (const device of devices.data ?? []) {
      map.set(device.id, deviceStatus(device.lastSeenAt, new Date(now), thresholds));
    }
    return map;
  }, [devices.data, now, thresholds]);

  const mapTracks = useMemo(
    () => tracksToMap(tracks.data?.tracks ?? [], colors.hex),
    [tracks.data, colors],
  );
  const positions = useMemo<MapPosition[]>(
    () =>
      (devices.data ?? []).flatMap((device) =>
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
    [devices.data, colors, statuses],
  );
  const bounds = useMemo(
    () =>
      boundsOf([
        ...mapTracks.flatMap((track) => track.segments.flat()),
        ...positions.map((position) => [position.lon, position.lat] as const),
      ]),
    [mapTracks, positions],
  );
  const fitKey = `${today}:${deviceList
    .map((device) => device.id)
    .sort()
    .join(",")}`;
  const distanceByDevice = new Map(
    (tracks.data?.tracks ?? []).map((track) => [track.deviceId, track.distanceM]),
  );

  const mapLabel =
    positions.length === 0
      ? "Map. No device has reported a position yet."
      : `Map of today’s tracks and the latest position of ${format.list(
          deviceList.filter((device) => device.lastLocation !== null).map((device) => device.name),
        )}. The same details are listed in the device cards.`;

  return (
    <div className="map-layout live-page">
      <DocumentTitle title="Live" />
      <div className="map-layout__head">
        <PageHeader
          title="Live"
          description={<LiveSummary devices={deviceList} statuses={statuses} today={today} />}
        />
      </div>

      <div className="map-layout__map">
        {styleUrl === null ? null : (
          <LazyTrailMap
            label={mapLabel}
            styleUrl={styleUrl}
            dark={dark}
            tracks={mapTracks}
            positions={positions}
            // Framed once both the positions and today's tracks are known, never on partial data.
            fit={{
              key: fitKey,
              bounds: devices.isPending || tracks.isPending ? null : bounds,
              maxZoom: 15,
            }}
            cooperativeGestures
          />
        )}
      </div>

      {/* Beside the map on wide screens this panel scrolls by itself. */}
      <section className="map-layout__body" aria-label="Devices and uploads" ref={scrollable}>
        <section className="section" aria-labelledby={devicesHeadingId}>
          <h2 className="visually-hidden" id={devicesHeadingId}>
            Devices
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
          ) : deviceList.length === 0 ? (
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
            <PlainList className="live-page__cards">
              {deviceList.map((device) => (
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

        {deviceList.length === 0 ? null : <UploadFeed devices={deviceList} slotOf={colors.slot} />}
      </section>
    </div>
  );
}
