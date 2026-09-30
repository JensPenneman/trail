export interface ZonedParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of an instant in an IANA time zone. */
export function zonedParts(instant: number, timeZone: string): ZonedParts {
  const parts: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    switch (part.type) {
      case "year":
        parts.year = Number(part.value);
        break;
      case "month":
        parts.month = Number(part.value);
        break;
      case "day":
        parts.day = Number(part.value);
        break;
      case "hour":
        parts.hour = Number(part.value);
        break;
      case "minute":
        parts.minute = Number(part.value);
        break;
      case "second":
        parts.second = Number(part.value);
        break;
      default:
        break;
    }
  }
  return parts;
}
