import type { DeviceStatus } from "@trail/contracts/deviceStatus";
import { statusPresentation } from "../devices/statusPresentation";
import { Icon } from "./Icon";
import "./StatusBadge.css";

interface StatusBadgeProps {
  status: DeviceStatus;
  thresholds: { liveMinutes: number; staleHours: number };
}

export function StatusBadge({ status, thresholds }: StatusBadgeProps) {
  const presentation = statusPresentation(status, thresholds);
  return (
    <span className={`status-badge status-badge--${status}`} title={presentation.description}>
      {status === "live" ? (
        <span className="status-badge__pulse" aria-hidden="true" />
      ) : (
        <Icon name={presentation.icon} />
      )}
      <span>{presentation.label}</span>
    </span>
  );
}
