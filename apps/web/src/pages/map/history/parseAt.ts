import { startOfLocalDay } from "../../../time/startOfLocalDay";
import { zonedParts } from "../../../time/zonedParts";

const shape = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

const pad = (value: number): string => String(value).padStart(2, "0");

/** A moment as `?at=` writes it: `YYYY-MM-DDTHH:MM` in the account's time zone. */
export function atText(time: number, timeZone: string): string {
  const { year, month, day, hour, minute } = zonedParts(time * 1000, timeZone);
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** The text of `?at=` if it has the shape of one, else null (a hand-edited link is ignored). */
export function parseAtText(value: string | null): string | null {
  return value !== null && shape.test(value) ? value : null;
}

/**
 * The moment `?at=` names, in epoch seconds, in `timeZone`: the local day's
 * start and the time of day after it (so a day of 23 or 25 hours is right at
 * both ends). Null for a text that is not one, a day that does not exist or a
 * time that does not exist on its day.
 */
export function momentOf(text: string | null, timeZone: string): number | null {
  const match = text === null ? null : shape.exec(text);
  if (match === null || text === null) return null;
  const day = text.slice(0, 10);
  let start: number;
  try {
    start = startOfLocalDay(day, timeZone) / 1000;
  } catch {
    return null;
  }
  const moment = start + Number(match[4]) * 3600 + Number(match[5]) * 60;
  return atText(moment, timeZone).slice(0, 10) === day ? moment : null;
}
