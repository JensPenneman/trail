/*
 * Powerful features are switched off. Only features Chromium recognises are
 * listed: an unknown name makes the browser log a console error on every page.
 * WebAuthn is allowed for the page itself; clipboard writes (copy buttons for
 * the device credentials) and fullscreen (map) stay available to our own origin.
 */
const denied = [
  "accelerometer",
  "autoplay",
  "camera",
  "display-capture",
  "encrypted-media",
  "geolocation",
  "gyroscope",
  "hid",
  "idle-detection",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
  "clipboard-read",
];

const selfOnly = [
  "publickey-credentials-create",
  "publickey-credentials-get",
  "clipboard-write",
  "fullscreen",
];

export const permissionsPolicy = [
  ...denied.map((feature) => `${feature}=()`),
  ...selfOnly.map((feature) => `${feature}=(self)`),
].join(", ");
