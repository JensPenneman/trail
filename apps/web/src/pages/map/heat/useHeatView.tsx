import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { useEffect, useId, useMemo, useState } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { boundsOf } from "../../../map/boundsOf";
import { heatmapParamsFor } from "../../../map/heatmapParamsFor";
import type { Bounds, MapViewState } from "../../../map/mapTypes";
import { useDays } from "../../../queries/useDays";
import { useHeatmap } from "../../../queries/useHeatmap";
import { addDays } from "../../../time/addDays";
import { Button } from "../../../ui/Button";
import { ErrorState } from "../../../ui/ErrorState";
import { LoadingBlock } from "../../../ui/LoadingBlock";
import { Notice } from "../../../ui/Notice";
import { PlainList } from "../../../ui/PlainList";
import { Skeleton } from "../../../ui/Skeleton";
import { Spinner } from "../../../ui/Spinner";
import { useDebouncedValue } from "../../../ui/useDebouncedValue";
import { inactiveView, type MapViewContent } from "../MapViewContent";
import { me } from "../me";
import type { MapSelection } from "../resolveMapSelection";
import { HeatLegend } from "./HeatLegend";
import "./HeatView.css";

/** The stats API allows 400 days per request. */
const statsDays = 400;

export interface HeatViewInput {
  active: boolean;
  selection: MapSelection;
  devices: UseQueryResult<DeviceSummary[]>;
  /** What the map shows now; the heatmap is asked for that box. */
  viewport: MapViewState | null;
  /**
   * Whether this view frames the camera: only when the page opened on it.
   * Coming from another view, the map stays where it is and fills in.
   */
  framesCamera: boolean;
  dark: boolean;
  today: string;
}

/**
 * Heat: everywhere the devices have been, as a heatmap of all recorded
 * points, with totals and the busiest places in view. Heatmaps cover the
 * signed-in person's own devices only. Asks for nothing while another view
 * is shown.
 */
export function useHeatView({
  active,
  selection,
  devices,
  viewport,
  framesCamera,
  dark,
  today,
}: HeatViewInput): MapViewContent {
  const format = useFormatter();
  const totalsId = useId();
  const busiestId = useId();
  const [focus, setFocus] = useState<{
    key: string;
    lon: number;
    lat: number;
    zoom: number;
  } | null>(null);
  // Own devices only: the filter's own devices, or all of them when it lists none of those.
  const deviceIds = selection.own?.deviceIds ?? null;
  const settledView = useDebouncedValue(viewport, 300);
  const heatmap = useHeatmap(
    !active || settledView === null ? null : heatmapParamsFor(settledView, deviceIds),
  );
  const days = useDays(
    active ? { from: addDays(today, -(statsDays - 1)), to: today, deviceIds } : null,
  );

  const deviceList = devices.data ?? [];
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

  // Opened here: start where the devices are now, else the map's default view.
  const initialBounds = useMemo(
    () =>
      boundsOf(
        (devices.data ?? []).flatMap((device) =>
          device.lastLocation === null
            ? []
            : [[device.lastLocation.lon, device.lastLocation.lat] as const],
        ),
      ),
    [devices.data],
  );
  const cells = active ? (heatmap.data?.cells ?? []) : [];
  // Once the first cells are known the camera tightens to them; after that it is the person's.
  const [dataBounds, setDataBounds] = useState<Bounds | null>(null);
  useEffect(() => {
    if (!framesCamera || dataBounds !== null || heatmap.data === undefined) return;
    if (heatmap.data.cells.length === 0) return;
    setDataBounds(boundsOf(heatmap.data.cells.map(([lon, lat]) => [lon, lat] as const)));
  }, [framesCamera, heatmap.data, dataBounds]);
  const busiest = useMemo(() => [...cells].sort((a, b) => b[2] - a[2]).slice(0, 5), [cells]);

  if (!active) return inactiveView;

  const selectedDevices = deviceList.filter(
    (device) => deviceIds === null || deviceIds.includes(device.id),
  );
  const totalPoints = selectedDevices.reduce((sum, device) => sum + device.counts.total, 0);
  const othersSelected = selection.people.some((person) => person.key !== me);

  return {
    title: "Heatmap",
    description: "Everywhere your devices have been, as a heatmap of every recorded point.",
    map: {
      label: "Heatmap of all recorded points in view. The busiest places are listed on this page.",
      heat: cells,
      ...(framesCamera
        ? {
            fit:
              dataBounds === null
                ? {
                    key: "heat:devices",
                    bounds: devices.isPending ? null : initialBounds,
                    maxZoom: 11,
                  }
                : { key: "heat:data", bounds: dataBounds, maxZoom: 13 },
          }
        : {}),
      focus,
    },
    controls: null,
    transport: null,
    chip: heatmap.isFetching ? (
      <p className="map-page__chip" aria-hidden="true">
        <Spinner size="s" /> Loading heatmap
      </p>
    ) : null,
    foot: null,
    panelLabel: "Totals and busiest places",
    panel: (
      <>
        <HeatLegend dark={dark} />
        {othersSelected ? (
          <Notice tone="info" title="Your own devices only">
            <p>The heatmap covers the points of your devices; nobody shares theirs for it.</p>
          </Notice>
        ) : null}

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
          <h2 className="section__title" id={totalsId}>
            Totals
          </h2>
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
          <h2 className="section__title" id={busiestId}>
            Busiest places in view
          </h2>
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
                      setFocus({
                        key: `${lon},${lat}:${Date.now()}`,
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
    ),
    // Heatmaps are one's own: nobody else's track is asked for.
    personTracks: inactiveView.personTracks,
    dialog: null,
  };
}
