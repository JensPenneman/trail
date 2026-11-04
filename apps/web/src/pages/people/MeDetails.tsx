import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { deviceAppInfo } from "@trail/contracts/deviceApp";
import { Link } from "react-router";
import { addDevicePath, devicePath } from "../../devices/devicePaths";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import type { useMeSummary } from "./useMeSummary";

interface MeDetailsProps {
  devices: UseQueryResult<DeviceSummary[]>;
  summary: ReturnType<typeof useMeSummary>;
}

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

/**
 * What Me's page says when there is something to set up: the way to adding a
 * device when there is none, the error when the devices could not be loaded, and
 * the hint when the first upload is awaited.
 */
export function MeDetails({ devices, summary }: MeDetailsProps) {
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
    </>
  );
}
