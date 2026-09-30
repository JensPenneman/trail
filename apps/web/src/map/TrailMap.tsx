import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "virtual:maplibre-worker-url";
import {
  type GeoJSONSource,
  type IControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMediaQuery } from "../ui/useMediaQuery";
import { accuracyFeatures } from "./accuracyFeatures";
import { ensureTrailLayers, trailSources } from "./ensureTrailLayers";
import { heatFeatures } from "./heatFeatures";
import type { Bounds, MapPoint, MapPosition, MapTrack, MapViewState } from "./mapTypes";
import { pointFeatures } from "./pointFeatures";
import { trackFeatures } from "./trackFeatures";
import "./TrailMap.css";

setWorkerUrl(workerUrl);

export interface TrailMapProps {
  /** Accessible name of the map canvas; the same information is always listed as text too. */
  label: string;
  styleUrl: string;
  dark: boolean;
  tracks?: readonly MapTrack[];
  positions?: readonly MapPosition[];
  visits?: readonly MapPoint[];
  cursors?: readonly MapPoint[];
  heat?: readonly (readonly [number, number, number])[];
  /** The camera fits `bounds` whenever `key` changes — never merely because data grew. */
  fit?: { key: string; bounds: Bounds | null; maxZoom?: number };
  /** The camera moves to this point whenever `key` changes. */
  focus?: { key: string; lon: number; lat: number; zoom: number } | null;
  initialView?: { center: readonly [number, number]; zoom: number };
  onViewChange?: (view: MapViewState) => void;
  /** Two-finger pan on touch screens, for maps embedded in a scrolling page. */
  cooperativeGestures?: boolean;
}

const fallbackView = { center: [4.35, 50.85] as const, zoom: 7 };

function setSourceData(map: MapLibreMap, id: string, data: GeoJSON.GeoJSON): void {
  void map.getSource<GeoJSONSource>(id)?.setData(data);
}

/** A map control button that re-fits the camera to everything shown. */
class FitControl implements IControl {
  readonly #onFit: () => void;
  #container: HTMLDivElement | null = null;

  constructor(onFit: () => void) {
    this.#onFit = onFit;
  }

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trail-map__fit";
    button.title = "Show everything";
    button.setAttribute("aria-label", "Show everything on the map");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5");
    svg.append(path);
    button.append(svg);
    button.addEventListener("click", this.#onFit);
    container.append(button);
    this.#container = container;
    return container;
  }

  onRemove(): void {
    this.#container?.remove();
    this.#container = null;
  }
}

function markerElement(): HTMLDivElement {
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  const pulse = document.createElement("span");
  pulse.className = "map-position__pulse";
  const dot = document.createElement("span");
  dot.className = "map-position__dot";
  element.append(pulse, dot);
  return element;
}

/**
 * The MapLibre map behind every map screen (this module and MapLibre load
 * lazily). Props describe what to show; the component keeps the GeoJSON
 * sources, DOM markers and camera in sync with them, and re-adds its layers
 * whenever the light/dark style is swapped.
 */
export function TrailMap({
  label,
  styleUrl,
  dark,
  tracks,
  positions,
  visits,
  cursors,
  heat,
  fit,
  focus,
  initialView,
  onViewChange,
  cooperativeGestures = false,
}: TrailMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const [problem, setProblem] = useState<"webgl" | "style" | null>(null);
  const construction = useRef({ styleUrl, label, initialView, cooperativeGestures });
  const loadedStyle = useRef(styleUrl);
  // False from the moment a style swap starts until its `style.load`: sources and layers can
  // only be touched in between. A ref, because effects of the same commit must see the change.
  const styleReady = useRef(false);
  const markers = useRef(new Map<string, { marker: Marker; element: HTMLDivElement }>());
  const fittedKey = useRef<string | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const reportView = useEffectEvent((instance: MapLibreMap) => {
    const bounds = instance.getBounds();
    onViewChange?.({
      bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      zoom: instance.getZoom(),
    });
  });

  const fitNow = useEffectEvent((instance: MapLibreMap, animate: boolean) => {
    if (fit?.bounds === undefined || fit.bounds === null) return;
    const [west, south, east, north] = fit.bounds;
    const container = instance.getContainer();
    const padding = Math.round(Math.min(container.clientWidth, container.clientHeight) * 0.12);
    instance.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: Math.max(24, Math.min(padding, 72)),
        maxZoom: fit.maxZoom ?? 16,
        animate: animate && !reducedMotion,
        duration: 700,
      },
    );
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const initial = construction.current;
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container,
        style: initial.styleUrl,
        center: [...(initial.initialView?.center ?? fallbackView.center)],
        zoom: initial.initialView?.zoom ?? fallbackView.zoom,
        maxZoom: 19,
        attributionControl: { compact: false },
        maplibreLogo: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: initial.cooperativeGestures,
        locale: { "Map.Title": initial.label },
      });
    } catch {
      setProblem("webgl");
      return;
    }
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new FitControl(() => fitNow(instance, true)), "top-right");
    instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    instance.on("style.load", () => {
      styleReady.current = true;
      setProblem(null);
      setStyleVersion((version) => version + 1);
    });
    // Third-party styles sometimes reference sprites they do not ship; a transparent
    // placeholder keeps MapLibre from warning about each of them.
    instance.setMissingStyleImageResolver((id) => {
      if (!instance.hasImage(id))
        instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    instance.on("error", () => {
      // Single tiles fail now and then; only a style that never loads leaves the map blank.
      if (!styleReady.current) setProblem("style");
    });
    instance.on("load", () => reportView(instance));
    instance.on("moveend", () => reportView(instance));
    setMap(instance);
    const placed = markers.current;
    return () => {
      for (const entry of placed.values()) entry.marker.remove();
      placed.clear();
      instance.remove();
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (map === null || loadedStyle.current === styleUrl) return;
    loadedStyle.current = styleUrl;
    styleReady.current = false;
    map.setStyle(styleUrl, { diff: false });
  }, [map, styleUrl]);

  useEffect(() => {
    map?.getCanvas().setAttribute("aria-label", label);
  }, [map, label]);

  useEffect(() => {
    if (map !== null && styleVersion > 0 && styleReady.current) ensureTrailLayers(map, dark);
  }, [map, styleVersion, dark]);

  useEffect(() => {
    if (map !== null && styleVersion > 0 && styleReady.current) {
      setSourceData(map, trailSources.tracks, trackFeatures(tracks ?? []));
    }
  }, [map, styleVersion, tracks]);

  useEffect(() => {
    if (map !== null && styleVersion > 0 && styleReady.current) {
      setSourceData(map, trailSources.accuracy, accuracyFeatures(positions ?? []));
    }
  }, [map, styleVersion, positions]);

  useEffect(() => {
    if (map !== null && styleVersion > 0 && styleReady.current) {
      setSourceData(map, trailSources.visits, pointFeatures(visits ?? []));
    }
  }, [map, styleVersion, visits]);

  useEffect(() => {
    if (map !== null && styleVersion > 0 && styleReady.current) {
      setSourceData(map, trailSources.cursors, pointFeatures(cursors ?? []));
    }
  }, [map, styleVersion, cursors]);

  useEffect(() => {
    if (map !== null && styleVersion > 0 && styleReady.current) {
      setSourceData(map, trailSources.heat, heatFeatures(heat ?? []));
    }
  }, [map, styleVersion, heat]);

  // Latest positions are DOM markers so "live" can pulse in CSS (and stop for reduced motion).
  useEffect(() => {
    if (map === null) return;
    const placed = markers.current;
    const seen = new Set<string>();
    for (const position of positions ?? []) {
      seen.add(position.id);
      let entry = placed.get(position.id);
      if (entry === undefined) {
        const element = markerElement();
        entry = {
          element,
          marker: new Marker({ element, anchor: "center" })
            .setLngLat([position.lon, position.lat])
            .addTo(map),
        };
        placed.set(position.id, entry);
      }
      entry.marker.setLngLat([position.lon, position.lat]);
      entry.element.className = `map-position device-color-${position.slot}${position.live ? " map-position--live" : ""}`;
    }
    for (const [id, entry] of placed) {
      if (!seen.has(id)) {
        entry.marker.remove();
        placed.delete(id);
      }
    }
  }, [map, positions]);

  // A key is fitted once, as soon as its bounds are known (data often arrives after the key).
  const fitKey = fit?.key;
  const hasFitBounds = fit?.bounds !== undefined && fit.bounds !== null;
  useEffect(() => {
    if (map === null || fitKey === undefined || !hasFitBounds || fittedKey.current === fitKey) {
      return;
    }
    // The first fit jumps (nothing to animate from); later ones glide.
    fitNow(map, fittedKey.current !== null);
    fittedKey.current = fitKey;
  }, [map, fitKey, hasFitBounds]);

  const focusKey = focus?.key;
  const focusTarget = useEffectEvent((instance: MapLibreMap) => {
    if (focus === undefined || focus === null) return;
    instance.easeTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(instance.getZoom(), focus.zoom),
      animate: !reducedMotion,
      duration: 600,
    });
  });
  useEffect(() => {
    if (map !== null && focusKey !== undefined) focusTarget(map);
  }, [map, focusKey]);

  return (
    <div className="trail-map">
      <div ref={containerRef} className="trail-map__canvas" />
      {problem === null ? null : (
        <div className="trail-map__problem" role="status">
          {problem === "webgl"
            ? "This browser can’t draw the map (WebGL is unavailable). Everything it would show is listed on this page."
            : "The map background could not be loaded. Check the connection; everything on the map is also listed on this page."}
        </div>
      )}
    </div>
  );
}
