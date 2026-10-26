import type { ChosenMode, TransportMode } from "@trail/contracts/transport";
import type { IconName } from "../ui/iconPaths";

interface ModeInfo {
  /** "Train" — for lists and the legend. */
  label: string;
  /** "Train" — the quick toggle's chip. */
  short: string;
  /** "a train ride" — inside a sentence. */
  phrase: string;
  icon: IconName;
}

/** Every transport mode in words and pictures; the colours are the CSS tokens `--mode-<mode>`. */
export const transportModeInfo: Readonly<Record<TransportMode, ModeInfo>> = {
  stationary: {
    label: "Standing still",
    short: "Still",
    phrase: "standing still",
    icon: "stationary",
  },
  walking: { label: "Walking", short: "Walk", phrase: "a walk", icon: "walking" },
  running: { label: "Running", short: "Run", phrase: "a run", icon: "running" },
  cycling: { label: "Cycling", short: "Bike", phrase: "a bike ride", icon: "cycling" },
  car: { label: "Car", short: "Car", phrase: "a drive", icon: "car" },
  bus: { label: "Bus", short: "Bus", phrase: "a bus ride", icon: "bus" },
  tram: { label: "Tram", short: "Tram", phrase: "a tram ride", icon: "tram" },
  metro: { label: "Metro", short: "Metro", phrase: "a metro ride", icon: "metro" },
  train: { label: "Train", short: "Train", phrase: "a train ride", icon: "train" },
  boat: { label: "Boat", short: "Boat", phrase: "a boat trip", icon: "boat" },
  plane: { label: "Plane", short: "Plane", phrase: "a flight", icon: "plane" },
  unknown: { label: "Unknown", short: "Other", phrase: "an unknown mode", icon: "unknown" },
};

/** The modes a person can choose, in the order of the pickers. */
export const chosenModes: readonly ChosenMode[] = [
  "walking",
  "running",
  "cycling",
  "car",
  "bus",
  "tram",
  "metro",
  "train",
  "boat",
  "plane",
  "stationary",
];

/** The quick toggle's chips; the rest are under "Other". */
export const quickModes: readonly ChosenMode[] = [
  "walking",
  "cycling",
  "car",
  "bus",
  "train",
  "tram",
  "metro",
];
