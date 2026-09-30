/**
 * Builds Overland's configuration deep link. Tapping it (or scanning it as a QR
 * code) on an iPhone with Overland installed saves the endpoint, token and
 * device ID in the app's settings.
 * Format: https://github.com/aaronpk/Overland-iOS#configuration-by-custom-url
 */
export function overlandSetupUrl(input: {
  endpoint: string;
  accessToken: string;
  deviceKey: string;
}): string {
  const query = new URLSearchParams({
    url: input.endpoint,
    token: input.accessToken,
    device_id: input.deviceKey,
  });
  return `overland://setup?${query.toString()}`;
}
