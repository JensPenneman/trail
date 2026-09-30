import { useEffect, useId, useMemo, useState } from "react";
import { DocumentTitle } from "../../app/DocumentTitle";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useFormatter } from "../../format/useFormatter";
import { boundsOf } from "../../map/boundsOf";
import { heatmapParamsFor } from "../../map/heatmapParamsFor";
import { LazyTrailMap } from "../../map/LazyTrailMap";
import type { Bounds, MapViewState } from "../../map/mapTypes";
import { useMapStyle } from "../../map/useMapStyle";
import { useDays } from "../../queries/useDays";
import { useDevices } from "../../queries/useDevices";
import { useHeatmap } from "../../queries/useHeatmap";
import { addDays } from "../../time/addDays";
import { useToday } from "../../time/useToday";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { PageHeader } from "../../ui/PageHeader";
import { PlainList } from "../../ui/PlainList";
import { Skeleton } from "../../ui/Skeleton";
import { Spinner } from "../../ui/Spinner";
import { useDebouncedValue } from "../../ui/useDebouncedValue";
import { DeviceFilter } from "../history/DeviceFilter";
import { HeatLegend } from "./HeatLegend";
import "./ExplorePage.css";

/** The stats API allows 400 days per request. */
const statsDays = 400;

/** Everywhere the devices have ever been, as a heatmap of all recorded points. */
export function ExplorePage() {
  const format = useFormatter();
  const totalsId = useId();
  const busiestId = useId();
  const devices = useDevices();
  const colors = useDeviceColors();
  const { styleUrl, dark } = useMapStyle();
  const today = useToday();
  const [deviceIds, setDeviceIds] = useState<readonly string[] | null>(null);
  const [view, setView] = useState<MapViewState | null>(null);
  const [focus, setFocus] = useState<{
    key: string;
    lon: number;
    lat: number;
    zoom: number;
  } | null>(null);
  const settledView = useDebouncedValue(view, 300);
  const heatmap = useHeatmap(
    settledView === null ? null : heatmapParamsFor(settledView, deviceIds),
  );
  const days = useDays({ from: addDays(today, -(statsDays - 1)), to: today, deviceIds });

  const deviceList = devices.data ?? [];
  const selectedDevices = deviceList.filter(
    (device) => deviceIds === null || deviceIds.includes(device.id),
  );
  const totalPoints = selectedDevices.reduce((sum, device) => sum + device.counts.total, 0);
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

  // Open where the devices are now; fall back to the map's default view.
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

  const cells = heatmap.data?.cells ?? [];
  // Once the first cells are known the camera tightens to them; after that it is the person's.
  const [dataBounds, setDataBounds] = useState<Bounds | null>(null);
  useEffect(() => {
    if (dataBounds !== null || heatmap.data === undefined || heatmap.data.cells.length === 0)
      return;
    setDataBounds(boundsOf(heatmap.data.cells.map(([lon, lat]) => [lon, lat] as const)));
  }, [heatmap.data, dataBounds]);
  const fit =
    dataBounds === null
      ? { key: "devices", bounds: initialBounds, maxZoom: 11 }
      : { key: "data", bounds: dataBounds, maxZoom: 13 };
  const busiest = useMemo(
    () => [...(heatmap.data?.cells ?? [])].sort((a, b) => b[2] - a[2]).slice(0, 5),
    [heatmap.data],
  );

  return (
    <div className="map-layout explore-page">
      <DocumentTitle title="Explore" />
      <div className="map-layout__head">
        <PageHeader
          title="Explore"
          description="Everywhere your devices have been, as a heatmap of every recorded point."
        />
      </div>

      <div className="map-layout__map">
        {styleUrl === null || devices.isPending ? null : (
          <LazyTrailMap
            label="Heatmap of all recorded points in view. The busiest places are listed on this page."
            styleUrl={styleUrl}
            dark={dark}
            heat={cells}
            fit={fit}
            focus={focus}
            onViewChange={setView}
          />
        )}
        {heatmap.isFetching ? (
          <p className="map-layout__chip" aria-hidden="true">
            <Spinner size="s" /> Loading heatmap
          </p>
        ) : null}
      </div>

      <div className="map-layout__body">
        {deviceList.length > 1 ? (
          <DeviceFilter
            devices={deviceList}
            selected={deviceIds}
            slotOf={colors.slot}
            onChange={setDeviceIds}
          />
        ) : null}

        <HeatLegend />

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
            <div className="card explore-page__totals">
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
              <p className="explore-page__note">
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
      </div>
    </div>
  );
}
