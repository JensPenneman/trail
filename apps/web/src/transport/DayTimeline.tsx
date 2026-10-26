import type { Segment } from "@trail/contracts/transport";
import { useId } from "react";
import { useFormatter } from "../format/useFormatter";
import { localDateOf } from "../time/localDateOf";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Icon } from "../ui/Icon";
import { LoadingBlock } from "../ui/LoadingBlock";
import { PlainList } from "../ui/PlainList";
import { Skeleton } from "../ui/Skeleton";
import { ModeSwatch } from "./ModeSwatch";
import { segmentTitle } from "./segmentTitle";
import "./DayTimeline.css";

interface DayTimelineProps {
  segments: readonly Segment[] | undefined;
  /** Points of the range still wait for processing. */
  pending: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Device names, when there is more than one device. */
  deviceName: (deviceId: string) => string | null;
  /** The day shown, or null for a period: times on other days get their date. */
  day: string | null;
  onOpen: (segment: Segment) => void;
}

/**
 * The stops and moves of the day as text (docs/architecture.md §17.6): every
 * segment on the map is here too, and opens the same dialog — the keyboard's
 * and the screen reader's way to the modes.
 */
export function DayTimeline({
  segments,
  pending,
  loading,
  error,
  onRetry,
  deviceName,
  day,
  onOpen,
}: DayTimelineProps) {
  const format = useFormatter();
  const headingId = useId();
  const when = (instant: string) =>
    day === null || localDateOf(instant, format.timeZone) !== day
      ? format.dayTime(instant)
      : format.time(instant);

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Timeline
        </h2>
        {pending ? (
          <p className="section__description" role="status">
            Still being worked out…
          </p>
        ) : null}
      </div>
      {loading ? (
        <LoadingBlock label="Loading the timeline">
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : error !== null ? (
        <ErrorState title="The timeline could not be loaded" error={error} onRetry={onRetry} />
      ) : (segments ?? []).length === 0 ? (
        <div className="card">
          <EmptyState icon="route" title="No stops or moves yet" level={3}>
            <p>
              Trail works out where you stopped and how you travelled shortly after the points
              arrive.
            </p>
          </EmptyState>
        </div>
      ) : (
        <PlainList ordered className="row-list card card--flush day-timeline">
          {(segments ?? []).map((segment) => {
            const name = deviceName(segment.deviceId);
            const move = segment.kind === "move";
            return (
              <li
                key={segment.id}
                className={`row-list__item day-timeline__item day-timeline__item--${segment.kind}`}
              >
                {move ? (
                  <ModeSwatch mode={segment.mode ?? "unknown"} dashed={segment.needsReview} />
                ) : (
                  <Icon name="stationary" className="day-timeline__stop" />
                )}
                <div className="row-list__main">
                  <p className="row-list__title">
                    {segmentTitle(segment)}
                    {move
                      ? ` · ${format.distance(segment.distanceM)}`
                      : ` · ${format.duration(segment.durationS)}`}
                    {segment.modeUser === null ? null : (
                      <span className="day-timeline__mark">set by you</span>
                    )}
                    {segment.needsReview ? (
                      <span className="day-timeline__mark day-timeline__mark--review">unsure</span>
                    ) : null}
                  </p>
                  <p className="row-list__meta">
                    {name === null ? null : `${name} · `}
                    {when(segment.startedAt)} – {when(segment.endedAt)}
                    {move
                      ? ` · ${format.duration(segment.durationS)} · ${format.speed(segment.averageSpeed ?? 0)}`
                      : null}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  icon="info"
                  aria-label={`Details of the ${segmentTitle(segment).toLowerCase()} from ${when(segment.startedAt)}`}
                  onClick={() => onOpen(segment)}
                >
                  Details
                </Button>
              </li>
            );
          })}
        </PlainList>
      )}
    </section>
  );
}
