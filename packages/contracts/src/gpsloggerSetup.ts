/**
 * GPSLogger's custom URL, with its placeholders: %TIME is ISO 8601 in UTC, %SPD
 * metres per second, %ACC and %ALT metres, %DIR degrees, %BATT percent. The
 * token travels in a header (`gpsloggerHeaders`), not in the URL.
 */
export function gpsloggerUrl(endpoint: string): string {
  return `${endpoint}?lat=%LAT&lon=%LON&timestamp=%TIME&accuracy=%ACC&altitude=%ALT&speed=%SPD&bearing=%DIR&batt=%BATT&charge=%ISCHARGING`;
}

/** GPSLogger's "HTTP Headers" field: one `Name: value` line. */
export function gpsloggerHeaders(accessToken: string): string {
  return `Authorization: Bearer ${accessToken}`;
}
