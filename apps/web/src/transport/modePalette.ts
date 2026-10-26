import type { TransportMode } from "@trail/contracts/transport";

/**
 * Transport mode colours for the map, the same values as the `--mode-<mode>`
 * tokens of tokens.css (MapLibre needs them as values, not variables). A
 * palette of its own, apart from the device colours: at the Transport level
 * lines are coloured by mode. Every mark keeps ≥ 3:1 against the map in its
 * scheme, and a mode is never shown by colour alone — the legend, the timeline
 * and the segment dialog name it.
 */
export const modePalette: Readonly<
  Record<"light" | "dark", Readonly<Record<TransportMode, string>>>
> = {
  light: {
    stationary: "#646a72",
    walking: "#1e7b34",
    running: "#687600",
    cycling: "#0b7a84",
    car: "#b53a14",
    bus: "#b25f00",
    tram: "#ae1f6c",
    metro: "#6a2bb5",
    train: "#22409a",
    boat: "#0267b2",
    plane: "#5b4334",
    unknown: "#7c828b",
  },
  dark: {
    stationary: "#a2a8b1",
    walking: "#5ec872",
    running: "#b7c83c",
    cycling: "#3ec6d2",
    car: "#ff7d55",
    bus: "#ffab44",
    tram: "#f26dab",
    metro: "#b78ff2",
    train: "#91a8f7",
    boat: "#52b6f8",
    plane: "#c9a58c",
    unknown: "#868c95",
  },
};
