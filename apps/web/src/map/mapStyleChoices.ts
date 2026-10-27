/** The map style control's options (docs/architecture.md §14); Satellite needs the server's imagery. */
export const mapStyleChoices = ["auto", "light", "dark", "satellite"] as const;
export type MapStyleChoice = (typeof mapStyleChoices)[number];

export const isMapStyleChoice = (value: string | null): value is MapStyleChoice =>
  value !== null && (mapStyleChoices as readonly string[]).includes(value);

export const mapStyleLabels: Readonly<Record<MapStyleChoice, string>> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
  satellite: "Satellite",
};
