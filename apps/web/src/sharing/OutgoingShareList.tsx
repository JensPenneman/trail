import type { OutgoingShare } from "@trail/contracts/share";
import { useFormatter } from "../format/useFormatter";
import { Button } from "../ui/Button";
import { PlainList } from "../ui/PlainList";
import { recipientName } from "./recipientName";
import { devicesText, expiryText, historyText, precisionInfo } from "./shareText";
import "./OutgoingShareList.css";

interface OutgoingShareListProps {
  shares: readonly OutgoingShare[];
  /** The signed-in person's devices, for the names a share lists. */
  devices: readonly { id: string; name: string }[];
  now: number;
  onChange: (share: OutgoingShare) => void;
  onStop: (share: OutgoingShare) => void;
}

const statusLabels = {
  pending: "Waiting for them",
  active: "Sees you",
  hidden: "Hid you",
} as const;

/** "You share with": each person, what they see and until when, with Change and Stop. */
export function OutgoingShareList({
  shares,
  devices,
  now,
  onChange,
  onStop,
}: OutgoingShareListProps) {
  const format = useFormatter();
  return (
    <PlainList className="row-list outgoing-shares">
      {shares.map((share) => {
        const name = recipientName(share);
        return (
          <li key={share.id} className="row-list__item outgoing-shares__item">
            <div className="row-list__main">
              <p className="row-list__title">
                {name}
                <span
                  className={`outgoing-shares__status outgoing-shares__status--${share.status}`}
                >
                  {statusLabels[share.status]}
                </span>
              </p>
              {share.recipient.displayName === null ? null : (
                <p className="row-list__meta">{share.recipient.email}</p>
              )}
              <p className="row-list__meta">
                {precisionInfo[share.precision].label} · {historyText(share.historyDays)} ·{" "}
                {devicesText(share.deviceIds, devices, format)}
                {share.includeDetails ? " · battery and activity" : ""}
              </p>
              <p className="row-list__meta">
                {expiryText(share.expiresAt, format, now)}
                {share.lastViewedAt === null
                  ? ""
                  : ` · last looked ${format.relative(share.lastViewedAt, now)}`}
              </p>
            </div>
            <div className="outgoing-shares__actions">
              <Button
                variant="ghost"
                icon="pencil"
                onClick={() => onChange(share)}
                aria-label={`Change sharing with ${name}`}
              >
                Change
              </Button>
              <Button
                variant="danger-outline"
                onClick={() => onStop(share)}
                aria-label={`Stop sharing with ${name}`}
              >
                Stop
              </Button>
            </div>
          </li>
        );
      })}
    </PlainList>
  );
}
