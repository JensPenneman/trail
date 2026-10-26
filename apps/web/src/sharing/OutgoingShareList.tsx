import type { OutgoingShare } from "@trail/contracts/share";
import { useFormatter } from "../format/useFormatter";
import { useConfirmShare } from "../queries/useConfirmShare";
import { Button } from "../ui/Button";
import { ErrorState } from "../ui/ErrorState";
import { PlainList } from "../ui/PlainList";
import { useAnnounce } from "../ui/useAnnounce";
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
  joined: "Joined — confirm?",
  active: "Sees you",
  hidden: "Hid you",
} as const;

/**
 * "You share with": each person, what they see and until when, with Change
 * and Stop. Someone who signed up with a waiting share's address sees nothing
 * until it is confirmed here (Trail does not verify addresses).
 */
export function OutgoingShareList({
  shares,
  devices,
  now,
  onChange,
  onStop,
}: OutgoingShareListProps) {
  const format = useFormatter();
  const confirm = useConfirmShare();
  const announce = useAnnounce();
  return (
    <>
      {confirm.isError ? (
        <div className="settings__padded">
          <ErrorState title="The share was not confirmed" error={confirm.error} />
        </div>
      ) : null}
      <PlainList className="row-list outgoing-shares">
        {shares.map((share) => {
          const name = recipientName(share);
          const joined = share.status === "joined";
          return (
            <li key={share.id} className="row-list__item outgoing-shares__item">
              <div className="row-list__main">
                <p className="row-list__title">
                  {joined ? `${name} (${share.recipient.email}) joined Trail — confirm?` : name}
                  <span
                    className={`outgoing-shares__status outgoing-shares__status--${share.status}`}
                  >
                    {statusLabels[share.status]}
                  </span>
                </p>
                {joined ? (
                  <p className="row-list__meta">
                    They see nothing until you confirm it is the person you meant.
                  </p>
                ) : share.recipient.displayName === null ? null : (
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
                {joined ? (
                  <Button
                    variant="primary"
                    icon="check"
                    busy={confirm.isPending && confirm.variables === share.id}
                    aria-label={`Confirm that ${name} (${share.recipient.email}) is the person you meant`}
                    onClick={() =>
                      confirm.mutate(share.id, {
                        onSuccess: () => announce(`${name} can see your location now.`),
                      })
                    }
                  >
                    Confirm
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    icon="pencil"
                    onClick={() => onChange(share)}
                    aria-label={`Change sharing with ${name}`}
                  >
                    Change
                  </Button>
                )}
                <Button
                  variant="danger-outline"
                  onClick={() => onStop(share)}
                  aria-label={`${joined ? "Cancel" : "Stop"} sharing with ${name}`}
                >
                  {joined ? "Cancel" : "Stop"}
                </Button>
              </div>
            </li>
          );
        })}
      </PlainList>
    </>
  );
}
