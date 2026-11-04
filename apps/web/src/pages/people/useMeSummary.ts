import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { ComponentProps } from "react";
import { useFormatter } from "../../format/useFormatter";
import { liveWindowOpen } from "../../live/liveWindowOpen";
import { useLiveState } from "../../live/useLiveState";
import { describeMe } from "../../people/describeMe";
import { latestOwnDevice } from "../../people/latestOwnDevice";
import type { PersonSummary } from "../../people/PersonSummary";
import { useDeviceMode } from "../../queries/useDeviceMode";

type SummaryProps = Pick<ComponentProps<typeof PersonSummary>, "freshness" | "doing">;

/**
 * The signed-in person as the list's row and their detail say it: what they
 * are doing now and how fresh that is, from the device that reported last.
 */
export function useMeSummary(
  devices: UseQueryResult<DeviceSummary[]>,
  now: number,
  thresholds: { liveMinutes: number; staleHours: number },
): SummaryProps & { latest: DeviceSummary | null; waiting: boolean } {
  const format = useFormatter();
  const list = devices.data ?? [];
  const latest = latestOwnDevice(list);
  // Devices added, nothing uploaded yet: the way to their setup rather than "no location".
  const waiting = list.length > 0 && list.every((device) => device.lastSeenAt === null);
  const mode = useDeviceMode(latest?.lastSeenAt == null ? null : latest.id);
  const location = latest?.lastLocation ?? null;
  const { connection } = useLiveState();
  const positionLive =
    location !== null && now - Date.parse(location.recordedAt) <= thresholds.liveMinutes * 60_000;
  // A copy restored from disk long after it was fetched is not live, whatever it holds.
  const windowOpen = liveWindowOpen(connection, devices.dataUpdatedAt, now, thresholds.liveMinutes);
  const live = positionLive && windowOpen;
  const doing =
    devices.data === undefined
      ? null
      : list.length === 0
        ? "No devices yet"
        : waiting
          ? "Waiting for the first upload"
          : describeMe(
              {
                location,
                current: mode.data === undefined ? undefined : mode.data.current,
                tripMode: latest?.liveTrip?.mode ?? null,
              },
              now,
              thresholds,
              format,
            );
  return {
    latest,
    waiting,
    freshness:
      location === null
        ? null
        : { recordedAt: location.recordedAt, live, asOf: positionLive && !windowOpen },
    doing,
  };
}
