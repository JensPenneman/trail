interface WeekInfo {
  firstDay: number;
}

interface LocaleWithWeekInfo {
  getWeekInfo?: () => WeekInfo;
  weekInfo?: WeekInfo;
}

/**
 * The first day of the week for a locale (1 = Monday … 7 = Sunday). Uses the
 * Intl week data where the browser has it (as a method in newer engines, a
 * property in older ones) and falls back to Monday, the ISO and European norm.
 */
export function firstDayOfWeek(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & LocaleWithWeekInfo;
    return info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1;
  } catch {
    return 1;
  }
}
