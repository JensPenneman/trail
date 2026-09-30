/** Replaces device tokens passed as `?token=` / `?access_token=` so URLs can be logged. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:token|access_token)=)[^&#]*/gi, "$1[redacted]");
}
