import type { Track } from "@trail/contracts/track";
import { useId } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { DeviceSwatch } from "../../../ui/DeviceSwatch";
import { PlainList } from "../../../ui/PlainList";
import { SectionTitle } from "../../../ui/SectionTitle";
import "./PeriodSummary.css";

interface PeriodSummaryProps {
  tracks: readonly Track[];
  nameOf: (deviceId: string) => string;
  /** The device's colour: one of the signed-in person's, or the person's who shares it. */
  swatchOf: (deviceId: string) => { slot: number; palette: "device" | "person" };
  /** Show dates next to the first/last times (multi-day periods). */
  withDate: boolean;
  /** No heading of its own: a group above it is the heading (the region is still "Summary"). */
  untitled?: boolean;
}

/** Distance, points and first/last point per device — the numbers behind the lines on the map. */
export function PeriodSummary({
  tracks,
  nameOf,
  swatchOf,
  withDate,
  untitled = false,
}: PeriodSummaryProps) {
  const format = useFormatter();
  const headingId = useId();
  const withData = tracks.filter((track) => track.total > 0);
  const when = (instant: string) => (withDate ? format.dayTime(instant) : format.time(instant));

  return (
    <section
      className="section"
      {...(untitled ? { "aria-label": "Summary" } : { "aria-labelledby": headingId })}
    >
      {untitled ? null : <SectionTitle id={headingId}>Summary</SectionTitle>}
      <PlainList className="period-summary card card--flush">
        {withData.map((track) => (
          <li key={track.deviceId} className="period-summary__row">
            <DeviceSwatch {...swatchOf(track.deviceId)} shape="line" />
            <div className="period-summary__main">
              <p className="period-summary__name">{nameOf(track.deviceId)}</p>
              <p className="period-summary__meta">
                {format.count(track.total)} {track.total === 1 ? "point" : "points"}
                {track.firstAt === null || track.lastAt === null
                  ? null
                  : ` · ${when(track.firstAt)} – ${when(track.lastAt)}`}
              </p>
            </div>
            <p className="period-summary__distance">{format.distance(track.distanceM)}</p>
          </li>
        ))}
      </PlainList>
    </section>
  );
}
