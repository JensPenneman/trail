import { zonedParts } from "./zonedParts";

const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

/** The calendar date `YYYY-MM-DD` an instant falls on in the given zone. */
export function localDateOf(instant: number | string, timeZone: string): string {
  const time = typeof instant === "string" ? Date.parse(instant) : instant;
  const { year, month, day } = zonedParts(time, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}
