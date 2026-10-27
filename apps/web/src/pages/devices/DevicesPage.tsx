import { type DeviceStatus, deviceStatus } from "@trail/contracts/deviceStatus";
import { useEffect, useId, useMemo } from "react";
import { useSearchParams } from "react-router";
import { DocumentTitle } from "../../app/DocumentTitle";
import { activitySlots } from "../../devices/activitySlots";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useLiveState } from "../../live/useLiveState";
import { useActivity } from "../../queries/useActivity";
import { useConfig } from "../../queries/useConfig";
import { useDays } from "../../queries/useDays";
import { useDevices } from "../../queries/useDevices";
import { useNow } from "../../time/useNow";
import { useToday } from "../../time/useToday";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PageHeader } from "../../ui/PageHeader";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { AddDeviceDialog } from "./AddDeviceDialog";
import { DeviceCard } from "./DeviceCard";
import { LiveSummary } from "./LiveSummary";
import { UploadFeed } from "./UploadFeed";
import "./DevicesPage.css";

const defaultThresholds = { liveMinutes: 15, staleHours: 12 };
const activityHours = 48;
const activity48h = { hours: activityHours, deviceIds: null };
/** The server sums a day up 10 s after an upload (`DailyStatsScheduler`); a little after that. */
const dayStatsDelayMs = 12_000;

/**
 * Every phone of the signed-in person and the proof that each keeps sending:
 * how many are live and the last upload, a card per device (status, last
 * upload, trip, battery, movement, today's points and distance, last position,
 * 48 hours of activity), the feed of uploads as they arrive, and the way to
 * add one (`?add=1` opens the dialog).
 */
export function DevicesPage() {
  const [params, setParams] = useSearchParams();
  const howId = useId();
  const devices = useDevices();
  const config = useConfig();
  const colors = useDeviceColors();
  const now = useNow(15_000);
  const today = useToday();
  const thresholds = config.data?.thresholds ?? defaultThresholds;
  const list = devices.data ?? [];
  const some = list.length > 0;
  // Today's sums per device (its distance) and the hours of the last two days, of every device.
  const day = useMemo(() => ({ from: today, to: today, deviceIds: null }), [today]);
  const days = useDays(some ? day : null);
  const activity = useActivity(some ? activity48h : null);
  // An upload changes today's distance once the server has summed the day up again.
  const latestUpload = useLiveState().uploads[0]?.receivedAt;
  const refetchDays = days.refetch;
  useEffect(() => {
    if (latestUpload === undefined) return;
    const timer = setTimeout(() => void refetchDays(), dayStatsDelayMs);
    return () => clearTimeout(timer);
  }, [latestUpload, refetchDays]);
  const statuses = useMemo(() => {
    const map = new Map<string, DeviceStatus>();
    for (const device of list) {
      map.set(device.id, deviceStatus(device.lastSeenAt, new Date(now), thresholds));
    }
    return map;
  }, [list, now, thresholds]);
  const distanceByDevice = new Map(
    (days.data?.days ?? [])
      .filter((entry) => entry.date === today)
      .map((entry) => [entry.deviceId, entry.distanceM]),
  );
  const adding = params.get("add") === "1";
  const setAdding = (open: boolean) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (open) next.set("add", "1");
        else next.delete("add");
        return next;
      },
      { replace: true },
    );

  return (
    <div className="page">
      <DocumentTitle title="Devices" />
      <PageHeader
        title="Devices"
        description={
          <>
            <p>Phones that send their location to Trail with Overland.</p>
            {some ? <LiveSummary devices={list} statuses={statuses} /> : null}
          </>
        }
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add device
          </Button>
        }
      />

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
      ) : devices.data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="devices"
            title="No devices yet"
            action={
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                Add your first device
              </Button>
            }
          >
            <p>Each phone gets its own access token, so you can see and manage them separately.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <PlainList className="devices-page__cards">
            {devices.data.map((device) => (
              <li key={device.id}>
                <DeviceCard
                  device={device}
                  status={statuses.get(device.id) ?? "never"}
                  thresholds={thresholds}
                  colorSlot={colors.slot(device.id)}
                  distanceTodayM={days.isPending ? null : (distanceByDevice.get(device.id) ?? 0)}
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
          {days.isError ? (
            <ErrorState
              title="Today’s distances could not be loaded"
              error={days.error}
              onRetry={() => void days.refetch()}
              retrying={days.isFetching}
            />
          ) : null}
          <UploadFeed devices={devices.data} slotOf={colors.slot} />
        </>
      )}

      <section className="section devices-page__how" aria-labelledby={howId}>
        <h2 className="section__title" id={howId}>
          How it works
        </h2>
        <ol className="devices-page__steps">
          <li>
            Install <strong>Overland</strong> (free, open source) from the App Store on the iPhone.
          </li>
          <li>Add a device here and scan the code it shows with the iPhone’s camera.</li>
          <li>
            Overland sends its points in batches; each upload appears here within seconds, and the
            phone keeps anything it could not send until the next try.
          </li>
        </ol>
      </section>

      <AddDeviceDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
