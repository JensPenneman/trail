import type { PathColour } from "@trail/contracts/preferences";
import type { TransportMode } from "@trail/contracts/transport";
import type { Formatter } from "../../format/createFormatter";
import { paceBands, speedBands } from "./pathClasses";
import type { PathColouring } from "./pathColours";
import { speedRamp, timeTones } from "./pathPalette";

/** One class of a legend: its colour as drawn on the map and what it stands for. */
interface LegendItem {
  color: string;
  label: string;
}

/** What the map's legends say about how the lines are coloured now. */
export interface PathLegendModel {
  by: PathColour;
  /** The sequential key (speed or pace): the five steps and the words at its ends; null for the rest. */
  key: { title: string; steps: LegendItem[]; ends: readonly [string, string] } | null;
  /** The classes of a categorical colouring (time of day); empty otherwise. */
  classes: LegendItem[];
  /** The devices drawn, for the device colouring's legend. */
  deviceIds: string[];
  /** The modes drawn, for the mode colouring's legend. */
  modes: ReadonlySet<TransportMode>;
  /** A line style the map uses on top of the colour: a move to review, the path within a stop, a gap. */
  lineStyles: {
    review: boolean;
    stopPaths: boolean;
    gaps: boolean;
    /** A stop is drawn (grey under the colourings that colour moves only). */
    stops: boolean;
    /** A stretch whose speed cannot be told is drawn in the unknown grey. */
    unknownSpeed: boolean;
  };
}

const bandLabels = (onFoot: boolean, format: Formatter): string[] => {
  if (!onFoot) {
    const [a, b, c, d] = speedBands.map((value) => Math.round(value * 3.6));
    return [`under ${a} km/h`, `${a}–${b}`, `${b}–${c}`, `${c}–${d}`, `${d} km/h or more`];
  }
  const [a, b, c, d] = paceBands.map((value) => format.pace(value));
  return [`slower than ${a}`, `${a} to ${b}`, `${b} to ${c}`, `${c} to ${d}`, `faster than ${d}`];
};

const hour = (value: number, format: Formatter): string =>
  new Intl.DateTimeFormat(format.locale, {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(Date.UTC(2000, 0, 1, value));

/** The legend of a colouring: the speed key, or the time-of-day classes, as words and colours. */
export function pathLegend(
  colouring: PathColouring,
  drawn: {
    deviceIds: readonly string[];
    modes: ReadonlySet<TransportMode>;
    review: boolean;
    stopPaths: boolean;
    gaps: boolean;
    stops?: boolean;
    unknownSpeed?: boolean;
  },
  format: Formatter,
): PathLegendModel {
  const scheme = colouring.dark ? "dark" : "light";
  const onFoot = colouring.onFoot === true;
  const key =
    colouring.by === "speed"
      ? {
          title: onFoot ? "Pace" : "Speed",
          steps: bandLabels(onFoot, format).map((label, index) => ({
            label,
            color: speedRamp[scheme][index] ?? "",
          })),
          ends: ["Slower", "Faster"] as readonly [string, string],
        }
      : null;
  const classes =
    colouring.by === "time"
      ? [
          { name: "Night", from: 22, to: 6 },
          { name: "Morning", from: 6, to: 12 },
          { name: "Afternoon", from: 12, to: 18 },
          { name: "Evening", from: 18, to: 22 },
        ].map((band, index) => ({
          color: timeTones[scheme][index] ?? "",
          label: `${band.name} ${hour(band.from, format)}–${hour(band.to, format)}`,
        }))
      : [];
  return {
    by: colouring.by,
    key,
    classes,
    deviceIds: [...drawn.deviceIds],
    modes: drawn.modes,
    lineStyles: {
      review: drawn.review,
      stopPaths: drawn.stopPaths,
      gaps: drawn.gaps,
      stops: drawn.stops === true,
      unknownSpeed: drawn.unknownSpeed === true,
    },
  };
}
