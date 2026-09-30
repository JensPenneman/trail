import type { DeviceSummary } from "@trail/contracts/device";
import type { Visit } from "@trail/contracts/visit";
import { useId } from "react";
import { useFormatter } from "../../format/useFormatter";
import { localDateOf } from "../../time/localDateOf";
import { Button } from "../../ui/Button";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";

interface VisitListProps {
  visits: readonly Visit[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  devices: readonly DeviceSummary[];
  slotOf: (deviceId: string) => number;
  /** The day shown, or null for a period: times on other days get their date. */
  day: string | null;
  onShow: (visit: Visit) => void;
}

/** Places where iOS noticed a stay (Overland's visit tracking), in order of arrival. */
export function VisitList({
  visits,
  loading,
  error,
  onRetry,
  devices,
  slotOf,
  day,
  onShow,
}: VisitListProps) {
  const format = useFormatter();
  const headingId = useId();
  const when = (instant: string) =>
    day === null || localDateOf(instant, format.timeZone) !== day
      ? format.dayTime(instant)
      : format.time(instant);
  const nameOf = (deviceId: string) =>
    devices.find((device) => device.id === deviceId)?.name ?? "Removed device";
  const sorted = [...(visits ?? [])].sort(
    (a, b) => Date.parse(a.arrivedAt ?? a.recordedAt) - Date.parse(b.arrivedAt ?? b.recordedAt),
  );

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Visits
      </h2>
      {loading ? (
        <LoadingBlock label="Loading visits">
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : error !== null ? (
        <ErrorState title="Visits could not be loaded" error={error} onRetry={onRetry} />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState icon="visit" title="No visits in this period" level={3}>
            <p>
              iOS reports a visit when the phone stays somewhere for a while. It needs “Visit
              Tracking” on in Overland.
            </p>
          </EmptyState>
        </div>
      ) : (
        <PlainList ordered className="row-list card card--flush">
          {sorted.map((visit) => {
            const arrived = visit.arrivedAt;
            const departed = visit.departedAt;
            let title = `Around ${when(visit.recordedAt)}`;
            if (arrived !== null && departed !== null)
              title = `${when(arrived)} – ${when(departed)}`;
            else if (arrived !== null) title = `Arrived ${when(arrived)}, still there`;
            else if (departed !== null) title = `Left ${when(departed)}`;
            return (
              <li key={`${visit.deviceId}:${visit.recordedAt}`} className="row-list__item">
                <DeviceSwatch slot={slotOf(visit.deviceId)} />
                <div className="row-list__main">
                  <p className="row-list__title">
                    {title}
                    {arrived !== null && departed !== null ? (
                      <span className="muted">
                        {" "}
                        · {format.duration((Date.parse(departed) - Date.parse(arrived)) / 1000)}
                      </span>
                    ) : null}
                  </p>
                  <p className="row-list__meta">
                    {devices.length > 1 ? `${nameOf(visit.deviceId)} · ` : null}
                    {format.coordinates(visit.lat, visit.lon)}
                    {visit.accuracy === null ? null : ` ${format.accuracy(visit.accuracy)}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  icon="pin"
                  aria-label="Show this visit on the map"
                  onClick={() => onShow(visit)}
                >
                  Show
                </Button>
              </li>
            );
          })}
        </PlainList>
      )}
    </section>
  );
}
