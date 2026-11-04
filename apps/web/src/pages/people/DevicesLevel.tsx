import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { ErrorState } from "../../ui/ErrorState";
import { ConnectFirstPhone } from "./MeDetails";
import { MyDevices } from "./MyDevices";
import { PanelLevel } from "./PanelLevel";

interface DevicesLevelProps {
  /** Me's page. */
  backTo: string;
  devices: UseQueryResult<DeviceSummary[]>;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
}

/** One's devices, a level of Me's page (`?person=me&list=devices`): each with how it last reported. */
export function DevicesLevel({ backTo, devices, now, thresholds }: DevicesLevelProps) {
  const list = devices.data ?? [];
  return (
    <PanelLevel title="Your devices" backTo={backTo} backLabel="Me">
      {devices.isError ? (
        <ErrorState
          title="Your devices could not be loaded"
          error={devices.error}
          onRetry={() => void devices.refetch()}
          retrying={devices.isFetching}
        />
      ) : devices.data !== undefined && list.length === 0 ? (
        <ConnectFirstPhone level={3} />
      ) : list.length === 0 ? null : (
        <MyDevices untitled devices={list} now={now} thresholds={thresholds} />
      )}
    </PanelLevel>
  );
}
