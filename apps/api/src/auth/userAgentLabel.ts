/* Order matters: Edge and Opera include "Chrome", Chrome includes "Safari", and
 * iOS browsers all report their own token next to "Safari". */
const browsers: ReadonlyArray<[RegExp, string]> = [
  [/EdgiOS|EdgA|Edg\//, "Edge"],
  [/OPR\/|Opera|OPiOS/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/Firefox|FxiOS/, "Firefox"],
  [/Chrome|CriOS|Chromium/, "Chrome"],
  [/Safari/, "Safari"],
];

const systems: ReadonlyArray<[RegExp, string]> = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

const firstMatch = (value: string, table: ReadonlyArray<[RegExp, string]>): string | null =>
  table.find(([pattern]) => pattern.test(value))?.[1] ?? null;

/** What a browser says it is, as far as the tables above know: nothing else of the string is kept. */
function userAgentParts(userAgent: string | null): {
  browser: string | null;
  system: string | null;
} {
  if (userAgent === null || userAgent.trim() === "") return { browser: null, system: null };
  return { browser: firstMatch(userAgent, browsers), system: firstMatch(userAgent, systems) };
}

/** Short label for a session, e.g. "Safari on iPhone". */
export function userAgentLabel(userAgent: string | null): string {
  const { browser, system } = userAgentParts(userAgent);
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown browser";
}

/** The kind of device and browser, e.g. "iPhone · Safari": what a link's owner learns of a visitor. */
export function userAgentFamily(userAgent: string | null): string {
  const { browser, system } = userAgentParts(userAgent);
  if (browser !== null && system !== null) return `${system} · ${browser}`;
  return system ?? browser ?? "Unknown browser";
}
