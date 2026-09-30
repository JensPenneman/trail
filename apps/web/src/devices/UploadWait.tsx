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
  /**
   * The device's `lastSeenAt` when the wait began (null for a new device): any
   * later upload counts. Comparing server times avoids trusting this clock.
   */
  after: string | null;
  /** Wording for a new device or for a new token. */
  reason: "new-device" | "new-token";
}

/**
 * "Waiting for the first upload…" that turns into a success message the
 * moment the device's next upload is announced over the event stream (with
 * polling as a fallback when the stream is down).
 */
export function UploadWait({ deviceId, deviceName, after, reason }: UploadWaitProps) {
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
        <p className="upload-wait__text">
          In Overland, check that tracking is on. Batches go out every few minutes; “Send now” in
          the app sends one right away.
        </p>
      </div>
    </div>
  );
}
