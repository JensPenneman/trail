import type { StyleSpecification } from "maplibre-gl";
import { startTransition, useCallback, useMemo, useOptimistic } from "react";
import { useSearchParams } from "react-router";
import { useConfig } from "../queries/useConfig";
import { usePrefersDark } from "../ui/usePrefersDark";
import { isMapStyleChoice, type MapStyleChoice, mapStyleChoices } from "./mapStyleChoices";
import { rasterStyle } from "./rasterStyle";

const storageKey = "trail.mapStyle";
const withoutImagery: readonly MapStyleChoice[] = ["auto", "light", "dark"];

function remembered(): MapStyleChoice | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return isMapStyleChoice(value) ? value : null;
  } catch {
    return null;
  }
}

export interface MapStyle {
  /** The MapLibre style (a URL, or a document built here); null until the config has loaded. */
  style: string | StyleSpecification | null;
  /** Whether Trail's lines and dots are drawn for a dark background (dark and satellite maps). */
  dark: boolean;
  /** What the style control shows as chosen. */
  choice: MapStyleChoice;
  /** What it offers: Satellite only when the server has imagery. */
  choices: readonly MapStyleChoice[];
  setChoice: (choice: MapStyleChoice) => void;
}

/**
 * The map's style (docs/architecture.md §14): `?style=` in the URL, else the
 * one last chosen on this browser, else Auto, which follows the light or dark
 * setting of the system live. Satellite falls back to Auto on a server without
 * imagery, so an old link or choice never leaves the map blank.
 */
export function useMapStyle(): MapStyle {
  const { data: config } = useConfig();
  const prefersDark = usePrefersDark();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("style");
  const wanted = useMemo(
    () => (isMapStyleChoice(fromUrl) ? fromUrl : (remembered() ?? "auto")),
    [fromUrl],
  );
  // The router applies the new URL in a transition; until then the control shows the choice.
  const [shown, show] = useOptimistic(wanted);
  const styles = config?.mapStyles;
  const satellite = styles?.satellite;
  const imagery = useMemo(
    () =>
      satellite === undefined
        ? null
        : satellite.kind === "style"
          ? satellite.url
          : rasterStyle(satellite.tiles, satellite.attribution),
    [satellite],
  );
  const choice = shown === "satellite" && imagery === null ? "auto" : shown;
  const setChoice = useCallback(
    (next: MapStyleChoice) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Private browsing: the URL still carries the choice.
      }
      startTransition(() => {
        show(next);
        setParams(
          (current) => {
            const updated = new URLSearchParams(current);
            updated.set("style", next);
            return updated;
          },
          { replace: true, preventScrollReset: true },
        );
      });
    },
    [setParams, show],
  );

  const dark = choice === "dark" || choice === "satellite" || (choice === "auto" && prefersDark);
  const style =
    styles === undefined
      ? null
      : choice === "satellite"
        ? imagery
        : dark
          ? styles.dark
          : styles.light;
  return {
    style,
    dark,
    choice,
    choices: imagery === null ? withoutImagery : mapStyleChoices,
    setChoice,
  };
}
