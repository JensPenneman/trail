import { appsSpeaking, deviceAppInfo, type IngestProtocol } from "@trail/contracts/deviceApp";
import type { RequestHandler } from "express";
import { ingestDeviceOf } from "./ingestDevice";
import { sendIngestError } from "./sendIngestError";

/**
 * A device token works at its app's endpoint only: the app decides how Trail
 * reads what arrives (the OsmAnd format's speed unit is the app's), so a token
 * at another endpoint is refused with 403 and a message that names the app
 * the device is set up for — its holder learns nothing they could not try.
 */
export function requireApp(protocol: IngestProtocol): RequestHandler {
  const apps = appsSpeaking(protocol);
  return (req, res, next) => {
    const device = ingestDeviceOf(req);
    if (apps.includes(device.app)) {
      next();
      return;
    }
    sendIngestError(
      res,
      403,
      `This device is set up for ${deviceAppInfo[device.app].name} in Trail. To use another app, set the device up again on its page in Trail.`,
    );
  };
}
