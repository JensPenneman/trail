import type { Formatter } from "../../format/createFormatter";

/** Formatters of the charts' axes: compact, round values ("10 km", "1.5 hr"), in the reader's locale. */
export interface AxisFormats {
  distance: (metres: number) => string;
  duration: (seconds: number) => string;
  count: (value: number) => string;
  speedKmh: (kmh: number) => string;
}

export function axisFormats(format: Formatter): AxisFormats {
  const unit = (name: string, digits: number) =>
    new Intl.NumberFormat(format.locale, {
      style: "unit",
      unit: name,
      unitDisplay: "short",
      maximumFractionDigits: digits,
    });
  const kilometres = unit("kilometer", 1);
  const metres = unit("meter", 0);
  const hours = unit("hour", 1);
  const minutes = unit("minute", 0);
  const speed = unit("kilometer-per-hour", 0);
  const count = new Intl.NumberFormat(format.locale, { maximumFractionDigits: 1 });
  return {
    distance: (value) =>
      value === 0 ? "0" : value < 1000 ? metres.format(value) : kilometres.format(value / 1000),
    duration: (value) =>
      value === 0 ? "0" : value < 3600 ? minutes.format(value / 60) : hours.format(value / 3600),
    count: (value) => count.format(value),
    speedKmh: (value) => speed.format(value),
  };
}

/** A speed the API gives in km/h, the way the formatter writes speeds. */
export const formatKmh = (format: Formatter, kmh: number): string => format.speed(kmh / 3.6);

/** The change of a number against an earlier period, for a stat tile. */
export interface Change {
  text: string;
  direction: "up" | "down" | "flat";
}

/**
 * A change in words: by how much a measured amount (distance, time) moved,
 * in percent, or a count by how many — "12% more than the 30 days before",
 * "3 fewer than …", "As many as …". Null when there is nothing to compare with.
 */
export function changeOf(
  now: number,
  before: number,
  compared: string,
  options: { kind: "amount" | "count"; format: Formatter },
): Change | null {
  if (before <= 0 && now <= 0) return null;
  if (options.kind === "amount") {
    if (before <= 0) return { text: `More than ${compared}`, direction: "up" };
    const percent = Math.round(((now - before) / before) * 100);
    if (percent === 0) return { text: `About the same as ${compared}`, direction: "flat" };
    return {
      text: `${options.format.count(Math.abs(percent))}% ${percent > 0 ? "more" : "less"} than ${compared}`,
      direction: percent > 0 ? "up" : "down",
    };
  }
  const difference = now - before;
  if (difference === 0) return { text: `As many as ${compared}`, direction: "flat" };
  return {
    text: `${options.format.count(Math.abs(difference))} ${difference > 0 ? "more" : "fewer"} than ${compared}`,
    direction: difference > 0 ? "up" : "down",
  };
}
