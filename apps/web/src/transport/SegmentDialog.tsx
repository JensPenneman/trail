import type { ChosenMode, Segment } from "@trail/contracts/transport";
import { useId, useState } from "react";
import { useReadOnly } from "../app/useReadOnly";
import { useFormatter } from "../format/useFormatter";
import { visibleGapM } from "../map/lineGeometry";
import { useSegmentModeChange } from "../queries/useSegmentModeChange";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { errorMessage } from "../ui/errorMessage";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { OfflineReason } from "../ui/OfflineReason";
import { ModePicker } from "./ModePicker";
import { segmentTitle } from "./segmentTitle";
import { transportModeInfo } from "./transportModes";
import "./SegmentDialog.css";

interface SegmentDialogProps {
  segment: Segment;
  /** Shown when the account has more than one device. */
  deviceName: string | null;
  onClose: () => void;
}

/**
 * A stop or move up close (docs/architecture.md §17.6): its mode with icon,
 * how sure the inference is, speeds, distance and time, and the way to put
 * the mode right — or back to what was detected. A stop says how long it
 * lasted, where it was and, when it spread, how far one moved within it.
 */
export function SegmentDialog({ segment, deviceName, onClose }: SegmentDialogProps) {
  const format = useFormatter();
  const change = useSegmentModeChange(segment.id);
  const readOnly = useReadOnly();
  const offlineId = useId();
  const [saved, setSaved] = useState<string | null>(null);
  const move = segment.kind === "move";
  const mode = segment.mode ?? "stationary";
  const info = transportModeInfo[mode];
  const inferred = segment.modeInferred === null ? null : transportModeInfo[segment.modeInferred];
  const when = `${format.time(segment.startedAt)} – ${format.time(segment.endedAt)}`;
  const confirmable: ChosenMode | null =
    segment.modeInferred !== null && segment.modeInferred !== "unknown"
      ? segment.modeInferred
      : null;

  const apply = (next: ChosenMode | null) => {
    setSaved(null);
    change.mutate(next, {
      onSuccess: (response) => {
        const now = response.segment.mode ?? "unknown";
        setSaved(
          next === null
            ? `Back to the detected mode: ${transportModeInfo[now].label}.`
            : `Saved: ${transportModeInfo[now].label}.`,
        );
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={segmentTitle(segment)}
      description={deviceName === null ? when : `${deviceName} · ${when}`}
    >
      <div className="segment-dialog">
        <p className={`segment-dialog__mode mode-color-${mode}`}>
          <Icon name={info.icon} size={28} />
          <span>
            <strong>{move ? info.label : "Stop"}</strong>
            {segment.modeUser === null ? null : (
              <span className="segment-dialog__mark">
                <Icon name="check" /> set by you
              </span>
            )}
          </span>
        </p>
        <dl className="facts">
          {move && inferred !== null ? (
            <div>
              <dt>{segment.modeUser === null ? "Confidence" : "Detected"}</dt>
              <dd>
                {segment.modeUser === null ? null : `${inferred.label}, `}
                {segment.confidence === null ? "—" : format.percent(segment.confidence)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Duration</dt>
            <dd>{format.duration(segment.durationS)}</dd>
          </div>
          {move ? (
            <>
              <div>
                <dt>Distance</dt>
                <dd>{format.distance(segment.distanceM)}</dd>
              </div>
              <div>
                <dt>Average speed</dt>
                <dd>{format.speed(segment.averageSpeed ?? 0)}</dd>
              </div>
              <div>
                <dt>Top speed</dt>
                <dd>{format.speed(segment.maxSpeed ?? 0)}</dd>
              </div>
            </>
          ) : (
            <>
              {segment.spreadM !== null && segment.spreadM > visibleGapM ? (
                <div>
                  <dt>Moved within</dt>
                  <dd>{format.distance(segment.spreadM)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Place</dt>
                <dd>{format.coordinates(segment.centroid.lat, segment.centroid.lon)}</dd>
              </div>
            </>
          )}
        </dl>

        {move ? (
          <>
            {segment.needsReview && inferred !== null && confirmable !== null ? (
              <Notice
                tone="info"
                title={`Was this ${inferred.phrase}?`}
                action={
                  <Button
                    variant="primary"
                    icon="check"
                    busy={change.isPending}
                    disabled={readOnly}
                    aria-describedby={readOnly ? offlineId : undefined}
                    onClick={() => apply(confirmable)}
                  >
                    Yes, {inferred.label.toLowerCase()}
                  </Button>
                }
              >
                <p>Trail is not sure. Confirm it, or pick the right mode below.</p>
              </Notice>
            ) : null}
            <section className="segment-dialog__change" aria-label="Change mode">
              <h3 className="segment-dialog__heading">Change mode</h3>
              {readOnly ? (
                <OfflineReason id={offlineId}>
                  You’re offline: the mode can be corrected once you reconnect.
                </OfflineReason>
              ) : null}
              <ModePicker
                label="Change mode"
                current={segment.modeUser}
                disabled={change.isPending || readOnly}
                onPick={apply}
              />
            </section>
            {segment.modeUser === null ? null : (
              <Button
                icon="refresh"
                busy={change.isPending}
                disabled={readOnly}
                aria-describedby={readOnly ? offlineId : undefined}
                onClick={() => apply(null)}
              >
                Reset to detected
              </Button>
            )}
            {change.isError ? (
              <Notice tone="danger" role="alert" title="The mode could not be saved">
                <p>{errorMessage(change.error)}</p>
              </Notice>
            ) : null}
            <p className="segment-dialog__saved" role="status">
              {saved}
            </p>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
