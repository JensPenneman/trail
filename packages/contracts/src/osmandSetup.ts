/**
 * OsmAnd's online-tracking "Web address", whose placeholders the app fills in:
 * {0} latitude, {1} longitude, {2} the time in milliseconds, {3} the accuracy
 * in metres (OsmAnd calls it hdop), {4} altitude, {5} speed in m/s, {6}
 * bearing and {11} the battery in percent. OsmAnd cannot send headers, so the
 * token is a parameter (`token`), which Trail's logs never show.
 */
export function osmandUrlTemplate(input: { endpoint: string; accessToken: string }): string {
  return `${input.endpoint}?token=${input.accessToken}&lat={0}&lon={1}&timestamp={2}&accuracy={3}&altitude={4}&speed={5}&bearing={6}&batt={11}`;
}
