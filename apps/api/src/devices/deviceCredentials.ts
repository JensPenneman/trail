import type { DeviceCredentials } from "@trail/contracts/device";
import { overlandSetupUrl } from "@trail/contracts/overlandSetupUrl";

/** What the phone needs, including the `overland://setup` deep link (also rendered as a QR code). */
export function deviceCredentials(input: {
  ingestUrl: string;
  accessToken: string;
  deviceKey: string;
}): DeviceCredentials {
  return {
    endpoint: input.ingestUrl,
    accessToken: input.accessToken,
    deviceKey: input.deviceKey,
    setupUrl: overlandSetupUrl({
      endpoint: input.ingestUrl,
      accessToken: input.accessToken,
      deviceKey: input.deviceKey,
    }),
  };
}
