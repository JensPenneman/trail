import type { InsightsBucket } from "@trail/contracts/insights";

/** Names of a series' steps: in full for tooltips and tables, short for the axis. */
export interface BucketLabels {
  label: (bucket: string) => string;
  tick: (bucket: string) => string;
}

/** Noon UTC keeps a calendar date on its day whatever zone formats it. */
const noon = (date: string): number => Date.parse(`${date}T12:00:00Z`);

export function bucketLabels(bucket: InsightsBucket, locale: string): BucketLabels {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
  switch (bucket) {
    case "day": {
      const full = format({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const short = format({ weekday: "short", day: "numeric" });
      return { label: (date) => full.format(noon(date)), tick: (date) => short.format(noon(date)) };
    }
    case "week": {
      const full = format({ day: "numeric", month: "long", year: "numeric" });
      const short = format({ day: "numeric", month: "short" });
      return {
        label: (date) => `Week of ${full.format(noon(date))}`,
        tick: (date) => short.format(noon(date)),
      };
    }
    case "month": {
      const full = format({ month: "long", year: "numeric" });
      const short = format({ month: "short", year: "numeric" });
      return { label: (date) => full.format(noon(date)), tick: (date) => short.format(noon(date)) };
    }
  }
}

/** "per day", "per week", "per month". */
export const perBucket: Readonly<Record<InsightsBucket, string>> = {
  day: "per day",
  week: "per week",
  month: "per month",
};
