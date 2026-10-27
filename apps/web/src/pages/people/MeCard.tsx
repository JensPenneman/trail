import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { deviceStatus } from "@trail/contracts/deviceStatus";
import { type ReactNode, useId } from "react";
import { useFormatter } from "../../format/useFormatter";
import { OnMapBadge } from "../../people/OnMapBadge";
import { PersonAvatar } from "../../people/PersonAvatar";
import { Button } from "../../ui/Button";
import { RelativeTime } from "../../ui/RelativeTime";

interface MeCardProps {
  /** The signed-in person's name, for their initials. */
  name: string;
  devices: UseQueryResult<DeviceSummary[]>;
  now: number;
  thresholds: { liveMinutes: number; staleHours: number };
  /** Whether the map shows the signed-in person now. */
  shown: boolean;
  onShowOnMap: () => void;
  /** What the view has of one's own (Live's device cards and uploads), while the map shows it. */
  children?: ReactNode;
}

/**
 * The signed-in person, first in the People page's list: their devices in a
 * line — how many, how many are live, the last upload — or, while the map
 * shows them, what the view has of their own instead (in Live the device
 * cards and the upload feed).
 */
export function MeCard({
  name,
  devices,
  now,
  thresholds,
  shown,
  onShowOnMap,
  children,
}: MeCardProps) {
  const format = useFormatter();
  const titleId = useId();
  // Opened up (Live), the device cards below say all the line would.
  const details = shown ? children : null;
  const expanded = details !== null && details !== undefined && details !== false;
  const list = devices.data ?? [];
  const live = list.filter(
    (device) => deviceStatus(device.lastSeenAt, new Date(now), thresholds) === "live",
  ).length;
  const latest = list.reduce<string | null>(
    (newest, device) =>
      device.lastSeenAt !== null &&
      (newest === null || Date.parse(device.lastSeenAt) > Date.parse(newest))
        ? device.lastSeenAt
        : newest,
    null,
  );

  return (
    <section className={shown ? "me-card me-card--shown" : "me-card"} aria-labelledby={titleId}>
      <header className="me-card__header">
        <div className="me-card__who">
          <PersonAvatar name={name} slot="me" />
          <div className="me-card__heading">
            <h2 className="me-card__name" id={titleId}>
              Me
            </h2>
            {expanded || devices.isPending ? null : (
              <p className="me-card__status">
                {devices.isError ? (
                  "Your devices could not be loaded"
                ) : list.length === 0 ? (
                  "No devices yet"
                ) : (
                  <>
                    {format.count(list.length)} {list.length === 1 ? "device" : "devices"}
                    {live === 0 ? null : ` · ${format.count(live)} live`}
                    {latest === null ? (
                      " · no upload yet"
                    ) : (
                      <>
                        {" · last upload "}
                        <RelativeTime value={latest} tickMs={15_000} />
                      </>
                    )}
                  </>
                )}
              </p>
            )}
            {shown ? <OnMapBadge /> : null}
          </div>
        </div>
        <Button icon="pin" aria-describedby={titleId} onClick={onShowOnMap}>
          Show on map
        </Button>
      </header>
      {details}
    </section>
  );
}
