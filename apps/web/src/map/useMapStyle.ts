import { useConfig } from "../queries/useConfig";
import { usePrefersDark } from "../ui/usePrefersDark";

/** The MapLibre style for the current colour scheme, or null until the config has loaded. */
export function useMapStyle(): { styleUrl: string | null; dark: boolean } {
  const { data: config } = useConfig();
  const dark = usePrefersDark();
  if (config === undefined) return { styleUrl: null, dark };
  return { styleUrl: dark ? config.mapStyles.dark : config.mapStyles.light, dark };
}
