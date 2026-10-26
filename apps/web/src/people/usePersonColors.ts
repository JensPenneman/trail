import { useMemo } from "react";
import { usePeople } from "../queries/usePeople";
import { usePrefersDark } from "../ui/usePrefersDark";
import { assignPersonColors } from "./assignPersonColors";
import { personPalette } from "./personPalette";

export interface PersonColors {
  /** Palette slot for the CSS class `person-color-<slot>`. */
  slot(userId: string): number;
  /** The colour as hex (for the map), in the step for a dark or a light background. */
  hex(userId: string): string;
}

/**
 * The colours of the people who share with the signed-in person (the People
 * list's order). `hex` follows the colour scheme, unless `dark` says what the
 * map is drawn on (a dark map on a light page).
 */
export function usePersonColors(options: { dark?: boolean } = {}): PersonColors {
  const { data: people } = usePeople();
  const prefersDark = usePrefersDark();
  const dark = options.dark ?? prefersDark;
  return useMemo(() => {
    const slots = assignPersonColors(people ?? []);
    const palette = dark ? personPalette.dark : personPalette.light;
    const slot = (userId: string): number => slots.get(userId) ?? 0;
    return { slot, hex: (userId) => palette[slot(userId)] ?? palette[0] };
  }, [people, dark]);
}
