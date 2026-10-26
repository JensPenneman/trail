import { useMemo } from "react";
import { usePeople } from "../queries/usePeople";
import { usePrefersDark } from "../ui/usePrefersDark";
import { assignPersonColors } from "./assignPersonColors";
import { personPalette } from "./personPalette";

export interface PersonColors {
  /** Palette slot for the CSS class `person-color-<slot>`. */
  slot(userId: string): number;
  /** The colour as hex for the current colour scheme (for the map). */
  hex(userId: string): string;
}

/** The colours of the people who share with the signed-in person (the People list's order). */
export function usePersonColors(): PersonColors {
  const { data: people } = usePeople();
  const dark = usePrefersDark();
  return useMemo(() => {
    const slots = assignPersonColors(people ?? []);
    const palette = dark ? personPalette.dark : personPalette.light;
    const slot = (userId: string): number => slots.get(userId) ?? 0;
    return { slot, hex: (userId) => palette[slot(userId)] ?? palette[0] };
  }, [people, dark]);
}
