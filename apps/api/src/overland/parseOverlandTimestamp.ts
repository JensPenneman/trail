/*
 * Current Overland sends `2026-09-30T07:15:30Z`; old versions sent offsets
 * without a colon (`2015-10-01T08:00:00-0700`). Accepted: `Z`, `±HH:MM`,
 * `±HHMM`, optional fractional seconds. Everything else is rejected — never
 * guessed — because a wrong instant silently corrupts a track.
 */
const pattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/;

export function parseOverlandTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = pattern.exec(value);
  if (match === null) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone !== undefined && zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const offsetHours = Number(digits.slice(0, 2));
    const offsetRest = Number(digits.slice(2, 4));
    if (offsetHours > 23 || offsetRest > 59) return null;
    offsetMinutes = (zone.startsWith("-") ? -1 : 1) * (offsetHours * 60 + offsetRest);
  }

  // setUTCFullYear keeps years below 100 literal (Date.UTC would map 0026 to 1926).
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null; // 2026-02-30 and friends
  }
  const milliseconds = fraction === undefined ? 0 : Number(fraction.slice(0, 3).padEnd(3, "0"));
  date.setUTCHours(hour, minute, second, milliseconds);
  return new Date(date.getTime() - offsetMinutes * 60_000);
}
