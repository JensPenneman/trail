import type { DeviceSummary } from "@trail/contracts/device";
import type { Trip } from "@trail/contracts/trip";
import { useId } from "react";
import { tripModeLabel } from "../../devices/tripModeLabel";
import { useFormatter } from "../../format/useFormatter";
import { localDateOf } from "../../time/localDateOf";
import { Button } from "../../ui/Button";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";

interface TripListProps {
  trips: readonly Trip[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  devices: readonly DeviceSummary[];
  slotOf: (deviceId: string) => number;
  /** The day shown, or null for a period: times on other days get their date. */
  day: string | null;
  onShow: (trip: Trip) => void;
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Trips started with Overland's trip button. */
export function TripList({
  trips,
  loading,
  error,
  onRetry,
  devices,
  slotOf,
  day,
  onShow,
}: TripListProps) {
  const format = useFormatter();
  const headingId = useId();
  const when = (instant: string) =>
    day === null || localDateOf(instant, format.timeZone) !== day
      ? format.dayTime(instant)
      : format.time(instant);
  const nameOf = (deviceId: string) =>
    devices.find((device) => device.id === deviceId)?.name ?? "Removed device";
  const sorted = [...(trips ?? [])].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Trips
      </h2>
      {loading ? (
        <LoadingBlock label="Loading trips">
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : error !== null ? (
        <ErrorState title="Trips could not be loaded" error={error} onRetry={onRetry} />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState icon="route" title="No trips in this period" level={3}>
            <p>Trips appear when you start one with Overland’s trip button.</p>
          </EmptyState>
        </div>
      ) : (
        <PlainList ordered className="row-list card card--flush">
          {sorted.map((trip) => (
            <li key={`${trip.deviceId}:${trip.startedAt}`} className="row-list__item">
              <DeviceSwatch slot={slotOf(trip.deviceId)} />
              <div className="row-list__main">
                <p className="row-list__title">
                  {capitalise(tripModeLabel(trip.mode))} · {format.distance(trip.distanceM)}
                </p>
                <p className="row-list__meta">
                  {devices.length > 1 ? `${nameOf(trip.deviceId)} · ` : null}
                  {when(trip.startedAt)} – {when(trip.endedAt)} · {format.duration(trip.durationS)}
                  {trip.steps === null ? null : ` · ${format.count(trip.steps)} steps`}
                  {trip.stoppedAutomatically ? " · stopped automatically" : null}
                </p>
              </div>
              <Button
                variant="ghost"
                icon="play"
                aria-label="Start of this trip on the map"
                onClick={() => onShow(trip)}
              >
                Start
              </Button>
            </li>
          ))}
        </PlainList>
      )}
    </section>
  );
}
