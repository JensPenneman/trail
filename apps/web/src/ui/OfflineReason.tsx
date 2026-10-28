import type { ReactNode } from "react";
import { Icon } from "./Icon";
import "./OfflineReason.css";

interface OfflineReasonProps {
  /** The control it explains points here (`aria-describedby`). */
  id: string;
  children: ReactNode;
}

/** Why a control that changes something is off: changes are made with a network only. */
export function OfflineReason({ id, children }: OfflineReasonProps) {
  return (
    <p className="offline-reason" id={id}>
      <Icon name="warning" />
      <span>{children}</span>
    </p>
  );
}
