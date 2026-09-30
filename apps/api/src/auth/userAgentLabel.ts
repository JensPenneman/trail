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

/** Short label for a session, e.g. "Safari on iPhone". */
export function userAgentLabel(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === "") return "Unknown browser";
  const browser = firstMatch(userAgent, browsers);
  const system = firstMatch(userAgent, systems);
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown browser";
}
