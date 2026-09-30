export interface Formatter {
  readonly locale: string;
  readonly timeZone: string;
  /** 14:05 */
  time(instant: number | string): string;
  /** 14:05:09 */
  timeWithSeconds(instant: number | string): string;
  /** 30 Sept 2026, 14:05 */
  dateTime(instant: number | string): string;
  /** Wed 30 Sept, 14:05:09 — compact, for tables */
  dateTimeCompact(instant: number | string): string;
  /** Wed 30 Sept, 14:05 */
  dayTime(instant: number | string): string;
  /** Wed 30 Sept (a local calendar date `YYYY-MM-DD`) */
  day(date: string): string;
  /** Wednesday 30 September 2026 */
  dayLong(date: string): string;
  /** 30 Sept 2026 (a local calendar date, no weekday) */
  date(date: string): string;
  /** September 2026 */
  month(year: number, month: number): string;
  /** Weekday names for a calendar header, starting at `firstDay` (1 = Monday … 7 = Sunday). */
  weekdays(firstDay: number): { short: string; long: string }[];
  /** "12 sec ago", "5 min ago", "yesterday"; older than a week → the date. */
  relative(instant: number | string, now: number): string;
  /** 1 hr 12 min */
  duration(seconds: number): string;
  /** 850 m, 12.3 km */
  distance(metres: number): string;
  /** 32 km/h */
  speed(metresPerSecond: number): string;
  /** 12 m */
  metres(metres: number): string;
  /** ±12 m */
  accuracy(metres: number): string;
  /** 84% (level 0..1) */
  percent(fraction: number): string;
  /** 12,345 */
  count(value: number): string;
  /** 51.0543° N, 3.7174° E — four decimals (≈ 10 m) unless more are asked for */
  coordinates(lat: number, lon: number, digits?: 4 | 5): string;
  /** iPhone, iPad and Watch */
  list(items: readonly string[]): string;
}

const toTime = (instant: number | string): number =>
  typeof instant === "string" ? Date.parse(instant) : instant;

/** Noon UTC keeps a calendar date on the same day whatever zone formats it. */
const calendarDate = (date: string): number => Date.parse(`${date}T12:00:00Z`);

/**
 * Every visible number and time goes through here: one place decides the
 * locale conventions and the signed-in person's time zone.
 */
export function createFormatter(locale: string, timeZone: string): Formatter {
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeWithSeconds = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateTime = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const dateTimeCompact = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dayTime = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const dayWithYear = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const dayLong = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const month = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  const plainDate = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const weekdayShort = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" });
  const weekdayLong = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const count = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const kilometres = (digits: number) =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "kilometer",
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  const kilometresPrecise = kilometres(1);
  const kilometresWhole = kilometres(0);
  const metres = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "meter",
    maximumFractionDigits: 0,
  });
  const speed = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer-per-hour",
    maximumFractionDigits: 0,
  });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const hours = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
  });
  const minutes = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "minute",
    unitDisplay: "short",
  });
  const seconds = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
  });
  const degrees = {
    4: new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
    5: new Intl.NumberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5 }),
  } as const;
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const currentYear = new Date().getUTCFullYear();

  return {
    locale,
    timeZone,
    time: (instant) => time.format(toTime(instant)),
    timeWithSeconds: (instant) => timeWithSeconds.format(toTime(instant)),
    dateTime: (instant) => dateTime.format(toTime(instant)),
    dateTimeCompact: (instant) => dateTimeCompact.format(toTime(instant)),
    dayTime: (instant) => dayTime.format(toTime(instant)),
    day: (date) => {
      const value = calendarDate(date);
      return new Date(value).getUTCFullYear() === currentYear
        ? day.format(value)
        : dayWithYear.format(value);
    },
    dayLong: (date) => dayLong.format(calendarDate(date)),
    date: (date) => plainDate.format(calendarDate(date)),
    month: (year, monthNumber) => month.format(Date.UTC(year, monthNumber - 1, 15, 12)),
    weekdays: (firstDay) =>
      Array.from({ length: 7 }, (_, index) => {
        // 2024-01-01 was a Monday; ISO weekday numbers run Monday = 1 … Sunday = 7.
        const isoDay = ((firstDay - 1 + index) % 7) + 1;
        const value = Date.UTC(2024, 0, isoDay, 12);
        return { short: weekdayShort.format(value), long: weekdayLong.format(value) };
      }),
    relative: (instant, now) => {
      const elapsed = Math.floor((now - toTime(instant)) / 1000);
      if (elapsed < 5 && elapsed > -60) return "just now";
      if (elapsed < 0) return relative.format(Math.ceil(-elapsed / 60), "minute");
      if (elapsed < 60) return relative.format(-elapsed, "second");
      if (elapsed < 3600) return relative.format(-Math.floor(elapsed / 60), "minute");
      if (elapsed < 86_400) return relative.format(-Math.floor(elapsed / 3600), "hour");
      if (elapsed < 7 * 86_400) return relative.format(-Math.floor(elapsed / 86_400), "day");
      return dateTime.format(toTime(instant));
    },
    duration: (totalSeconds) => {
      const rounded = Math.max(0, Math.round(totalSeconds));
      if (rounded < 60) return seconds.format(rounded);
      const totalMinutes = Math.round(rounded / 60);
      const wholeHours = Math.floor(totalMinutes / 60);
      const restMinutes = totalMinutes % 60;
      if (wholeHours === 0) return minutes.format(restMinutes);
      if (restMinutes === 0) return hours.format(wholeHours);
      return `${hours.format(wholeHours)} ${minutes.format(restMinutes)}`;
    },
    distance: (value) => {
      // Rounded first, so 999.6 m becomes "1.0 km" rather than "1,000 m".
      if (Math.round(value) < 1000) return metres.format(Math.round(value));
      const km = value / 1000;
      return km < 100 ? kilometresPrecise.format(km) : kilometresWhole.format(km);
    },
    speed: (value) => speed.format(value * 3.6),
    metres: (value) => metres.format(value),
    accuracy: (value) => `±${metres.format(value)}`,
    percent: (fraction) => percent.format(fraction),
    count: (value) => count.format(value),
    coordinates: (lat, lon, digits = 4) =>
      `${degrees[digits].format(Math.abs(lat))}° ${lat >= 0 ? "N" : "S"}, ${degrees[digits].format(Math.abs(lon))}° ${lon >= 0 ? "E" : "W"}`,
    list: (items) => list.format(items),
  };
}
