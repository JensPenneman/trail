/**
 * The interface is written in English, so dates must use English month and
 * day names — but in the person's regional conventions (24-hour clock, day
 * before month, decimal comma in Belgium). The first English preference wins;
 * otherwise English for the region of the first preference (nl-BE → en-BE),
 * provided Intl knows that combination.
 */
export function resolveFormatLocale(languages: readonly string[]): string {
  for (const tag of languages) {
    try {
      if (new Intl.Locale(tag).language === "en") return tag;
    } catch {
      // Ignore malformed tags from the browser.
    }
  }
  for (const tag of languages) {
    try {
      const region = new Intl.Locale(tag).maximize().region;
      if (region === undefined) continue;
      const candidate = `en-${region}`;
      if (Intl.DateTimeFormat.supportedLocalesOf([candidate]).length > 0) return candidate;
    } catch {
      // Ignore malformed tags from the browser.
    }
  }
  return "en-GB";
}
