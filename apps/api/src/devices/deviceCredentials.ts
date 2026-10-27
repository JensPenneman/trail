import type { DeviceCredentials } from "@trail/contracts/device";
import type { DeviceApp, IngestProtocol } from "@trail/contracts/deviceApp";
import { gpsloggerHeaders, gpsloggerUrl } from "@trail/contracts/gpsloggerSetup";
import { osmandUrlTemplate } from "@trail/contracts/osmandSetup";
import { overlandSetupUrl } from "@trail/contracts/overlandSetupUrl";
import { owntracksSetupUrl, trackerIdFor } from "@trail/contracts/owntracksSetup";
import { traccarSetupUrl } from "@trail/contracts/traccarSetup";

/**
 * What the phone needs, for the device's app (docs/trackers.md): the endpoint,
 * the token where that app expects it, and a setup link where the app takes
 * one (Overland, OwnTracks, Traccar Client), also rendered as a QR code.
 */
export function deviceCredentials(input: {
  app: DeviceApp;
  ingestUrls: Readonly<Record<IngestProtocol, string>>;
  accessToken: string;
  deviceKey: string;
  deviceName: string;
}): DeviceCredentials {
  const { accessToken, deviceKey, ingestUrls } = input;
  switch (input.app) {
    case "overland":
      return {
        app: "overland",
        endpoint: ingestUrls.overland,
        accessToken,
        deviceKey,
        setupUrl: overlandSetupUrl({ endpoint: ingestUrls.overland, accessToken, deviceKey }),
      };
    case "owntracks": {
      const connection = {
        url: ingestUrls.owntracks,
        username: deviceKey,
        password: accessToken,
        deviceId: deviceKey,
        trackerId: trackerIdFor(input.deviceName),
      };
      return {
        app: "owntracks",
        endpoint: connection.url,
        username: connection.username,
        accessToken,
        deviceId: connection.deviceId,
        trackerId: connection.trackerId,
        setupUrls: {
          ios: owntracksSetupUrl(connection, "ios"),
          android: owntracksSetupUrl(connection, "android"),
        },
      };
    }
    case "traccar":
      return {
        app: "traccar",
        endpoint: ingestUrls.osmand,
        accessToken,
        setupUrl: traccarSetupUrl({ serverUrl: ingestUrls.osmand, identifier: accessToken }),
      };
    case "osmand":
      return {
        app: "osmand",
        endpoint: ingestUrls.osmand,
        accessToken,
        urlTemplate: osmandUrlTemplate({ endpoint: ingestUrls.osmand, accessToken }),
      };
    case "gpslogger":
      return {
        app: "gpslogger",
        endpoint: ingestUrls.osmand,
        accessToken,
        url: gpsloggerUrl(ingestUrls.osmand),
        headers: gpsloggerHeaders(accessToken),
      };
  }
}
