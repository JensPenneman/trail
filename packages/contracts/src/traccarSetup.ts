/*
 * Traccar Client 10 filters its fixes itself: with the highest accuracy it
 * takes every fix and sends one after 30 m, 30 s or a 30° turn, whichever
 * comes first, and stop detection pauses it while the phone stands still.
 */
export const traccarTracking = {
  accuracy: "highest",
  distance: 30,
  interval: 30,
  angle: 30,
} as const;

/**
 * Traccar Client's configuration link (`org.traccar.client://`, which its own
 * QR scanner reads as well): the server URL, the device identifier — Trail's
 * device token — and Trail's recommended tracking, buffering and stop
 * detection. The app asks before it applies a link.
 */
export function traccarSetupUrl(input: { serverUrl: string; identifier: string }): string {
  const query = new URLSearchParams({
    url: input.serverUrl,
    id: input.identifier,
    accuracy: traccarTracking.accuracy,
    distance: String(traccarTracking.distance),
    interval: String(traccarTracking.interval),
    angle: String(traccarTracking.angle),
    buffer: "true",
    stop_detection: "true",
  });
  return `org.traccar.client://setup?${query.toString()}`;
}
