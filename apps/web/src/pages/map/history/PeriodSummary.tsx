import type { Track } from "@trail/contracts/track";
import { useId } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { DeviceSwatch } from "../../../ui/DeviceSwatch";
import { PlainList } from "../../../ui/PlainList";
import "./PeriodSummary.css";

interface PeriodSummaryProps {
  tracks: readonly Track[];
  nameOf: (deviceId: string) => string;
  /** The device's colour: one of the signed-in person's, or the person's who shares it. */
  swatchOf: (deviceId: string) => { slot: number; palette: "device" | "person" };
  /** Show dates next to the first/last times (multi-day periods). */
  withDate: boolean;
}

/** Distance, points and first/last point per device — the numbers behind the lines on the map. */
export function PeriodSummary({ tracks, nameOf, swatchOf, withDate }: PeriodSummaryProps) {
  const format = useFormatter();
  const headingId = useId();
  const withData = tracks.filter((track) => track.total > 0);
  const when = (instant: string) => (withDate ? format.dayTime(instant) : format.time(instant));

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 className="section__title" id={headingId}>
        Summary
      </h2>
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
