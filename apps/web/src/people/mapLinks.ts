/** Opens the position in Apple Maps, with the person's name as the pin's label. */
export function appleMapsUrl(lat: number, lon: number, name: string): string {
  const url = new URL("https://maps.apple.com/");
  url.searchParams.set("ll", `${lat},${lon}`);
  url.searchParams.set("q", name);
  return url.toString();
}

/** Opens the position in Google Maps (its documented search URL). */
export function googleMapsUrl(lat: number, lon: number): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${lat},${lon}`);
  return url.toString();
}
