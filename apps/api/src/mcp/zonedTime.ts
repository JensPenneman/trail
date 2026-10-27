const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/* `longOffset` names an offset `GMT+01:00` (or `GMT-03:30`), and UTC itself
 * `GMT` in some ICU versions; ISO 8601 wants `+01:00` and `+00:00`. */
const offsetOf = (name: string): string => {
  const match = /^GMT([+\-−])(\d{2}):(\d{2})$/.exec(name);
  if (match === null) return "+00:00";
  return `${match[1] === "+" ? "+" : "-"}${match[2]}:${match[3]}`;
};

/**
 * An instant as ISO 8601 in an IANA time zone, with that zone's offset at the
 * time: `2026-10-26T09:41:07+01:00`. Milliseconds appear only when there are
 * any. Agents read these, so a time says both when it was and what the
 * owner's clock showed.
 */
export function formatInZone(instant: Date, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const milliseconds = instant.getUTCMilliseconds();
  const fraction = milliseconds === 0 ? "" : `.${String(milliseconds).padStart(3, "0")}`;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${fraction}${offsetOf(part("timeZoneName"))}`;
}

/** The UTC offset of a time zone at an instant, as ISO 8601 writes it: `+01:00`. */
export function utcOffsetAt(instant: Date, timeZone: string): string {
  const name = formatterFor(timeZone)
    .formatToParts(instant)
    .find((candidate) => candidate.type === "timeZoneName")?.value;
  return offsetOf(name ?? "GMT");
}
