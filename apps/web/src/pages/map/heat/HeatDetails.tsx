import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { HeatmapResponse } from "@trail/contracts/heatmap";
import { useId, useMemo } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { useDays } from "../../../queries/useDays";
import { addDays } from "../../../time/addDays";
import { Button } from "../../../ui/Button";
import { ErrorState } from "../../../ui/ErrorState";
import { LoadingBlock } from "../../../ui/LoadingBlock";
import { Notice } from "../../../ui/Notice";
import { PlainList } from "../../../ui/PlainList";
import { SectionTitle } from "../../../ui/SectionTitle";
import { Skeleton } from "../../../ui/Skeleton";
import "./HeatView.css";

/** The stats API allows 400 days per request. */
const statsDays = 400;

interface HeatDetailsProps {
  devices: UseQueryResult<DeviceSummary[]>;
  /** The own devices the heatmap covers; null for all of them. */
  deviceIds: readonly string[] | null;
  today: string;
  heatmap: UseQueryResult<HeatmapResponse>;
  /** Moves the map to a busy place. */
  onShow: (place: { lon: number; lat: number; zoom: number }) => void;
}

/**
 * What Heat says in numbers, in Me's "Heat" group: the totals (points ever
 * recorded; days, distance and earliest day of the last 12 months) and the
 * busiest places in view. It is rendered only while the group is open, so the
 * 12-month request is made only then.
 */
export function HeatDetails({ devices, deviceIds, today, heatmap, onShow }: HeatDetailsProps) {
  const format = useFormatter();
  const totalsId = useId();
  const busiestId = useId();
  const days = useDays({ from: addDays(today, -(statsDays - 1)), to: today, deviceIds });
  const yearly = useMemo(() => {
    const dates = new Set<string>();
    let distance = 0;
    let first: string | null = null;
    for (const day of days.data?.days ?? []) {
      if (day.points === 0) continue;
      dates.add(day.date);
      distance += day.distanceM;
      if (first === null || day.date < first) first = day.date;
    }
    return { days: dates.size, distance, first };
  }, [days.data]);
  const selected = (devices.data ?? []).filter(
    (device) => deviceIds === null || deviceIds.includes(device.id),
  );
  const totalPoints = selected.reduce((sum, device) => sum + device.counts.total, 0);
  const busiest = useMemo(
    () => [...(heatmap.data?.cells ?? [])].sort((a, b) => b[2] - a[2]).slice(0, 5),
    [heatmap.data],
  );

  return (
    <>
      {heatmap.isError ? (
        <ErrorState
          title="The heatmap could not be loaded"
          error={heatmap.error}
          onRetry={() => void heatmap.refetch()}
          retrying={heatmap.isFetching}
        />
      ) : null}
      {heatmap.data?.truncated === true ? (
        <Notice tone="info" title="Showing the busiest places only">
          <p>This view holds more cells than one map can draw. Zoom in to see every place.</p>
        </Notice>
      ) : null}

      <section className="section" aria-labelledby={totalsId}>
        <SectionTitle id={totalsId}>Totals</SectionTitle>
        {devices.isPending || days.isPending ? (
          <LoadingBlock label="Loading totals">
            <Skeleton height="6rem" />
          </LoadingBlock>
        ) : days.isError ? (
          <ErrorState
            title="Totals could not be loaded"
            error={days.error}
            onRetry={() => void days.refetch()}
          />
        ) : (
          <div className="card heat-view__totals">
            <dl className="stats">
              <div className="stats__item">
                <dt>Points</dt>
                <dd>{format.count(totalPoints)}</dd>
              </div>
              <div className="stats__item">
                <dt>Days with data</dt>
                <dd>{format.count(yearly.days)}</dd>
              </div>
              <div className="stats__item">
                <dt>Distance</dt>
                <dd>{format.distance(yearly.distance)}</dd>
              </div>
              <div className="stats__item">
                <dt>Earliest day</dt>
                <dd>{yearly.first === null ? "—" : format.date(yearly.first)}</dd>
              </div>
            </dl>
            <p className="heat-view__note">
              Points count everything ever recorded; days, distance and the earliest day cover the
              last 12 months.
            </p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby={busiestId}>
        <SectionTitle id={busiestId}>Busiest places in view</SectionTitle>
        {heatmap.data === undefined ? (
          <LoadingBlock label="Loading places">
            <Skeleton height="3rem" />
            <Skeleton height="3rem" />
          </LoadingBlock>
        ) : busiest.length === 0 ? (
          <p className="muted">
            Nothing recorded in this part of the map. Zoom out or move the map to where you have
            been.
          </p>
        ) : (
          <PlainList ordered className="row-list card card--flush">
            {busiest.map(([lon, lat, count]) => (
              <li key={`${lon},${lat}`} className="row-list__item">
                <div className="row-list__main">
                  <p className="row-list__title">{format.count(count)} points</p>
                  <p className="row-list__meta">{format.coordinates(lat, lon)}</p>
                </div>
                <Button
                  variant="ghost"
                  icon="pin"
                  aria-label="Show this place on the map"
                  onClick={() =>
                    onShow({
                      lon,
                      lat,
                      zoom: Math.min(17, (heatmap.data?.cellZoom ?? 12) - 2),
                    })
                  }
                >
                  Show
                </Button>
              </li>
            ))}
          </PlainList>
        )}
      </section>
    </>
  );
}
