import { type UseQueryResult, useQueryClient } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import type { HeatMeasure } from "@trail/contracts/heatmap";
import type { TransportMode } from "@trail/contracts/transport";
import { useEffect, useId, useMemo, useState } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { boundsOf } from "../../../map/boundsOf";
import { heatmapParamsFor } from "../../../map/heatmapParamsFor";
import { heatScale } from "../../../map/heatScale";
import { heatPlaces } from "../../../map/heatTiles";
import type { Bounds, MapHeat, MapViewState } from "../../../map/mapTypes";
import { heatAnsweredZoom, useHeatmap } from "../../../queries/useHeatmap";
import { Button } from "../../../ui/Button";
import { Spinner } from "../../../ui/Spinner";
import { useDebouncedValue } from "../../../ui/useDebouncedValue";
import { inactiveView, type MapViewContent } from "../MapViewContent";
import type { MapSelection } from "../resolveMapSelection";
import { HeatDetails } from "./HeatDetails";
import { HeatLegend } from "./HeatLegend";
import { HeatLens } from "./HeatLens";
import { hasMode, hasPeriod, heatMeasureInfo } from "./heatMeasures";
import type { HeatPeriod } from "./heatPeriod";
import { periodDetail, periodLabel } from "./lensLabel";

/** What the map says of itself, by what it counts. */
const mapLabels: Record<HeatMeasure, string> = {
  moving: "Heatmap of time on the move in view: where you travelled longest.",
  speed: "Heatmap of average speed in view: where you moved fastest on average.",
  topspeed: "Heatmap of top speed in view: where you went fastest.",
  points: "Heatmap of all recorded points in view: everywhere your devices have been.",
  time: "Heatmap of time spent at places in view: where you stayed longest.",
  visits: "Heatmap of visits to places in view: where you stopped most often.",
  moving: "Heatmap of time on the move in view: where you travelled most.",
  speed: "Heatmap of average speed in view: where you moved fastest on average.",
  topspeed: "Heatmap of top speed in view: the fastest you went.",
};

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
  /** What Heat counts (`useHeatChoice`). */
  measure: HeatMeasure;
  /** The period in the address; null: all time. */
  period: HeatPeriod | null;
  /** One mode's moves, for the measures of movement; null: every mode. */
  mode: TransportMode | null;
  /** Takes the lens (measure, period, mode) off the address. */
  onClearLens: () => void;
}

/**
 * Heat: everywhere the devices have been, as a heatmap of all recorded
 * points; its key floats over the map, its totals and busiest places are the
 * Heat group of Me's page. Heatmaps cover the signed-in person's own devices
 * only (Heat is offered while nobody or Me is selected). Asks for nothing
 * while another view is shown.
 */
export function useHeatView({
  active,
  selection,
  devices,
  viewport,
  framesCamera,
  dark,
  today,
  measure,
  period,
  mode,
  onClearLens,
}: HeatViewInput): MapViewContent {
  const format = useFormatter();
  const keyId = useId();
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
    !active || settledView === null
      ? null
      : heatmapParamsFor(settledView, deviceIds, { heat: measure, period, mode }),
  );
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
  const shown = active ? heatmap.data : undefined;
  // The zoom the answer on screen was asked for at: a kept placeholder belongs to the request
  // before, not to the view now.
  const queryClient = useQueryClient();
  const answeredAt = heatAnsweredZoom(queryClient, shown);
  // One scale for the squares on the map and the legend, from the cells in view.
  const heat = useMemo<MapHeat | null>(
    () =>
      shown === undefined
        ? null
        : {
            cells: shown.cells,
            cellZoom: shown.cellZoom,
            scale: heatScale(
              shown.cells.map(([, , value]) => value),
              heatMeasureInfo[shown.heat].ladders,
            ),
          },
    [shown],
  );
  // Once the first cells are known the camera tightens to them; after that it is the person's.
  const [dataBounds, setDataBounds] = useState<Bounds | null>(null);
  useEffect(() => {
    if (!framesCamera || dataBounds !== null || heatmap.data === undefined) return;
    if (heatmap.data.cells.length === 0) return;
    setDataBounds(boundsOf(heatPlaces(heatmap.data).map(({ lon, lat }) => [lon, lat] as const)));
  }, [framesCamera, heatmap.data, dataBounds]);

  if (!active) return inactiveView;

  // What the answer on screen says it covers, not what was asked for: a measure or period just
  // chosen shows "Loading…" under its own title until its cells arrive.
  const periodFilters = hasPeriod(measure) && period !== null;
  const modeFilters = hasMode(measure) && mode !== null;
  const filtered = periodFilters || modeFilters;
  const answered = shown ?? null;
  // The server answers at zoom 18 for the cells of zoom 19 and 20 of the movement measures.
  const askedCellZoom = answeredAt === null ? null : Math.min(20, answeredAt + 5);
  const larger = answered !== null && askedCellZoom !== null && answered.cellZoom < askedCellZoom;
  const deviceCount = (deviceIds ?? (devices.data ?? []).map((device) => device.id)).length;
  const periodText =
    answered?.period != null
      ? periodDetail(answered.period, !filtered && hasPeriod(answered.heat), format)
      : answered === null
        ? null
        : "All time";
  const empty = answered !== null && answered.cells.length === 0;
  const keyStatus = heatmap.isError
    ? "The heatmap could not be loaded"
    : answered === null
      ? "Loading…"
      : empty
        ? hasPeriod(answered.heat)
          ? "Nothing in view for this period"
          : "Nothing in view"
        : null;

  return {
    title: "Heatmap",
    map: {
      label: `${mapLabels[answered?.heat ?? measure]} The busiest places are under Heat on your page.`,
      describedBy: keyId,
      heat,
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
    controls: filtered ? (
      <HeatLens
        period={periodFilters ? period : null}
        mode={modeFilters ? mode : null}
        onClear={onClearLens}
      />
    ) : null,
    transport: null,
    chip: heatmap.isFetching ? (
      <p className="map-page__chip" aria-hidden="true">
        <Spinner size="s" /> Loading heatmap
      </p>
    ) : null,
    // The key of the squares' colours, small over the map's bottom-left corner.
    legend: (
      <HeatLegend
        id={keyId}
        heat={answered?.heat ?? measure}
        scale={heat === null || empty ? null : heat.scale}
        detail={periodText}
        dark={dark}
        status={keyStatus}
        truncated={answered?.truncated === true}
        pending={answered?.pending === true}
        larger={larger}
        sumsDevices={answered?.heat === "moving" && deviceCount > 1}
        retry={
          heatmap.isError ? (
            <Button
              variant="ghost"
              onClick={() => void heatmap.refetch()}
              busy={heatmap.isFetching}
            >
              Retry
            </Button>
          ) : null
        }
      />
    ),
    foot: null,
    timeline: null,
    timelineLabel: "",
    meGroup: (
      <HeatDetails
        devices={devices}
        deviceIds={deviceIds}
        today={today}
        heatmap={heatmap}
        periodText={answered?.period == null ? null : periodLabel(answered.period, format)}
        onShow={(place) => setFocus({ key: `${place.lon},${place.lat}:${Date.now()}`, ...place })}
      />
    ),
    meGroupTitle: "Heat: totals, busiest places",
    personGroup: null,
    // Heatmaps are one's own: nobody else's track is asked for.
    player: null,
    personTracks: inactiveView.personTracks,
    dialog: null,
  };
}
