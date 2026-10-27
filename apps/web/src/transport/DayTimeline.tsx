import type { Segment } from "@trail/contracts/transport";
import { type ReactElement, useId, useMemo } from "react";
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

/** Longer than this between two segments of a device, the timeline says there is no data. */
const quietGapS = 60;

/**
 * The gaps in the recording, by the id of the segment after them: where a
 * device's phone recorded nothing for more than a minute between two of its
 * segments (stops and moves otherwise meet).
 */
function gapsBefore(segments: readonly Segment[]): Map<string, { from: string; seconds: number }> {
  const gaps = new Map<string, { from: string; seconds: number }>();
  const ended = new Map<string, string>();
  for (const segment of segments) {
    const before = ended.get(segment.deviceId);
    if (before !== undefined) {
      const seconds = (Date.parse(segment.startedAt) - Date.parse(before)) / 1000;
      if (seconds > quietGapS) gaps.set(segment.id, { from: before, seconds });
    }
    if (before === undefined || Date.parse(segment.endedAt) > Date.parse(before)) {
      ended.set(segment.deviceId, segment.endedAt);
    }
  }
  return gaps;
}

/**
 * The stops and moves of the day as text (docs/architecture.md §17.6): every
 * segment on the map is here too, and opens the same dialog — the keyboard's
 * and the screen reader's way to the modes. Where the phone recorded nothing
 * for more than a minute between two of them, a quiet row says so.
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
  const gaps = useMemo(() => gapsBefore(segments ?? []), [segments]);
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
          {(segments ?? []).flatMap((segment) => {
            const name = deviceName(segment.deviceId);
            const move = segment.kind === "move";
            const gap = gaps.get(segment.id);
            const rows: ReactElement[] = [];
            if (gap !== undefined) {
              rows.push(
                <li
                  key={`gap-${segment.id}`}
                  className="row-list__item day-timeline__item day-timeline__item--gap"
                >
                  <span className="day-timeline__gap" aria-hidden="true" />
                  <div className="row-list__main">
                    <p className="row-list__title">No data · {format.duration(gap.seconds)}</p>
                    <p className="row-list__meta">
                      {name === null ? null : `${name} · `}
                      {when(gap.from)} – {when(segment.startedAt)}
                    </p>
                  </div>
                </li>,
              );
            }
            rows.push(
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
              </li>,
            );
            return rows;
          })}
        </PlainList>
      )}
    </section>
  );
}
