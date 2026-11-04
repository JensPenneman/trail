import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { deviceAppInfo } from "@trail/contracts/deviceApp";
import { Link } from "react-router";
import { addDevicePath, devicePath } from "../../devices/devicePaths";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { MyDevices } from "./MyDevices";
import type { useMeSummary } from "./useMeSummary";

interface MeDetailsProps {
  devices: UseQueryResult<DeviceSummary[]>;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  summary: ReturnType<typeof useMeSummary>;
}

/**
 * The rest of Me's detail, after what the view says of one's day: one's
 * devices, always (no longer behind a Details button), the hint when the
 * first upload is awaited, and the way to adding a device when there is none.
 */
/** The way to adding a device, under Me's row in the list and in Me's detail. */
export function ConnectFirstPhone({ level }: { level: 2 | 3 }) {
  return (
    <EmptyState
      icon="devices"
      title="Connect your first phone"
      level={level}
      action={
        <LinkButton to={addDevicePath} variant="primary" icon="plus">
          Add a device
        </LinkButton>
      }
    >
      <p>
        Trail shows where you are as soon as the tracking app on your phone sends its first points.
        Adding one takes a minute: give it a name, choose the app, scan the code, done.
      </p>
    </EmptyState>
  );
}

export function MeDetails({ devices, now, thresholds, summary }: MeDetailsProps) {
  const list = devices.data ?? [];
  const { latest, waiting } = summary;
  return (
    <>
      {devices.isError ? (
        <ErrorState
          title="Your devices could not be loaded"
          error={devices.error}
          onRetry={() => void devices.refetch()}
          retrying={devices.isFetching}
        />
      ) : devices.data !== undefined && list.length === 0 ? (
        <ConnectFirstPhone level={3} />
      ) : null}

      {waiting && latest !== null ? (
        <p className="person-panel__setup">
          Open {deviceAppInfo[latest.source].name} on the phone and check that tracking is on.{" "}
          <Link to={devicePath(latest.id, "setup")}>Setup details</Link>
        </p>
      ) : null}

      {list.length === 0 ? null : <MyDevices devices={list} now={now} thresholds={thresholds} />}
    </>
  );
}
