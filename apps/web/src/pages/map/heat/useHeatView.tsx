import type { UseQueryResult } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { useEffect, useMemo, useState } from "react";
import { boundsOf } from "../../../map/boundsOf";
import { heatmapParamsFor } from "../../../map/heatmapParamsFor";
import { heatScale } from "../../../map/heatScale";
import type { Bounds, MapHeat, MapViewState } from "../../../map/mapTypes";
import { useHeatmap } from "../../../queries/useHeatmap";
import { ErrorState } from "../../../ui/ErrorState";
import { Notice } from "../../../ui/Notice";
import { Spinner } from "../../../ui/Spinner";
import { useDebouncedValue } from "../../../ui/useDebouncedValue";
import { inactiveView, type MapViewContent } from "../MapViewContent";
import type { MapSelection } from "../resolveMapSelection";
import { HeatDetails } from "./HeatDetails";
import { HeatLegend } from "./HeatLegend";

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
}: HeatViewInput): MapViewContent {
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
  // One scale for the squares on the map and the legend, from the cells in view.
  const heat = useMemo<MapHeat | null>(
    () =>
      shown === undefined
        ? null
        : {
            cells: shown.cells,
            cellZoom: shown.cellZoom,
            scale: heatScale(shown.cells.map(([, , count]) => count)),
          },
    [shown],
  );
  // Once the first cells are known the camera tightens to them; after that it is the person's.
  const [dataBounds, setDataBounds] = useState<Bounds | null>(null);
  useEffect(() => {
    if (!framesCamera || dataBounds !== null || heatmap.data === undefined) return;
    if (heatmap.data.cells.length === 0) return;
    setDataBounds(boundsOf(heatmap.data.cells.map(([lon, lat]) => [lon, lat] as const)));
  }, [framesCamera, heatmap.data, dataBounds]);

  if (!active) return inactiveView;

  return {
    title: "Heatmap",
    map: {
      label:
        "Heatmap of all recorded points in view: everywhere your devices have been. The busiest places are under Heat on your page.",
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
    controls: null,
    transport: null,
    chip: heatmap.isFetching ? (
      <p className="map-page__chip" aria-hidden="true">
        <Spinner size="s" /> Loading heatmap
      </p>
    ) : null,
    // The key of the squares' colours, small over the map's bottom-left corner.
    legend: heat === null ? null : <HeatLegend scale={heat.scale} dark={dark} />,
    // What could go wrong with the heatmap itself, at the map's foot whoever is selected.
    foot:
      !heatmap.isError && heatmap.data?.truncated !== true ? null : (
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
        </>
      ),
    timeline: null,
    timelineLabel: "",
    meGroup: (
      <HeatDetails
        devices={devices}
        deviceIds={deviceIds}
        today={today}
        heatmap={heatmap}
        onShow={(place) => setFocus({ key: `${place.lon},${place.lat}:${Date.now()}`, ...place })}
      />
    ),
    meGroupTitle: "Heat: totals, busiest places",
    personGroup: null,
    // Heatmaps are one's own: nobody else's track is asked for.
    personTracks: inactiveView.personTracks,
    dialog: null,
  };
}
