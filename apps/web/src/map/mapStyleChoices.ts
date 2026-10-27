import { type MapStyle, mapStyles } from "@trail/contracts/preferences";

/** The map style control's options (docs/architecture.md §14); Satellite needs the server's imagery. */
export const mapStyleChoices = mapStyles;
export type MapStyleChoice = MapStyle;

export const isMapStyleChoice = (value: string | null): value is MapStyleChoice =>
  value !== null && (mapStyleChoices as readonly string[]).includes(value);

export const mapStyleLabels: Readonly<Record<MapStyleChoice, string>> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
  satellite: "Satellite",
};
