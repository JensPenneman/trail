import type { DeviceApp } from "@trail/contracts/deviceApp";
import { useEffect, useState } from "react";
import { useFormatter } from "../format/useFormatter";
import { useDevice } from "../queries/useDevice";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";
import { useAnnounce } from "../ui/useAnnounce";
import "./UploadWait.css";

interface UploadWaitProps {
  deviceId: string;
  deviceName: string;
  /** The app on the phone, for what to check there. */
  app: DeviceApp;
  /**
   * The device's `lastSeenAt` when the wait began (null for a new device): any
   * later upload counts. Comparing server times avoids trusting this clock.
   */
  after: string | null;
  /** Wording for a new device or for a new token. */
  reason: "new-device" | "new-token";
}

/** What to check in each app while Trail waits, and how to send a point at once. */
const nudges: Readonly<Record<DeviceApp, string>> = {
  overland:
    "In Overland, check that tracking is on. Batches go out every few minutes; “Send now” in the app sends one right away.",
  owntracks:
    "In OwnTracks, check that the mode is HTTP and monitoring is not Quiet or Manual. It sends every point as it records it; the publish button on its map sends one right away.",
  traccar:
    "In Traccar Client, turn Continuous tracking on. It sends every point as it records it; “Send location” sends one right away.",
  osmand:
    "In OsmAnd, start recording a trip with Online tracking on: it sends points only while it records.",
  gpslogger:
    "In GPSLogger, start logging with Log to custom URL on. It sends every point it logs, after the logging interval.",
};

/**
 * "Waiting for the first upload…" that turns into a success message the
 * moment the device's next upload is announced over the event stream (with
 * polling as a fallback when the stream is down).
 */
export function UploadWait({ deviceId, deviceName, app, after, reason }: UploadWaitProps) {
  const format = useFormatter();
  const announce = useAnnounce();
  const [settled, setSettled] = useState(false);
  // The fallback polling stops once it has done its job.
  const device = useDevice(deviceId, settled ? false : 5000);
  const lastSeenAt = device.data?.lastSeenAt ?? null;
  const received =
    lastSeenAt !== null && (after === null || Date.parse(lastSeenAt) > Date.parse(after));

  useEffect(() => {
    if (!received || settled) return;
    setSettled(true);
    announce(
      reason === "new-device"
        ? `${deviceName} sent its first upload.`
        : `${deviceName} is sending with the new token.`,
    );
  }, [received, settled, announce, deviceName, reason]);

  if (received && device.data !== undefined) {
    return (
      <div className="upload-wait upload-wait--done">
        <span className="upload-wait__icon">
          <Icon name="check" />
        </span>
        <div>
          <p className="upload-wait__title">
            {reason === "new-device" ? "First upload received" : "The phone uses the new token"}
          </p>
          <p className="upload-wait__text">
            {format.count(device.data.counts.total)} points from {deviceName} so far. It shows up on
            Live from now on.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="upload-wait">
      <span className="upload-wait__icon">
        <Spinner />
      </span>
      <div>
        <p className="upload-wait__title">
          {reason === "new-device"
            ? "Waiting for the first upload…"
            : "Waiting for an upload with the new token…"}
        </p>
        <p className="upload-wait__text">{nudges[app]}</p>
      </div>
    </div>
  );
}
