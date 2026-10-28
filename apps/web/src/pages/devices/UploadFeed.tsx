import { useQueries } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { useMemo } from "react";
import { useFormatter } from "../../format/useFormatter";
import { mergeUploadFeed } from "../../live/mergeUploadFeed";
import { useLiveState } from "../../live/useLiveState";
import { ingestLogQuery } from "../../queries/ingestLogQuery";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { RelativeTime } from "../../ui/RelativeTime";
import { Skeleton } from "../../ui/Skeleton";
import "./UploadFeed.css";

interface UploadFeedProps {
  devices: readonly DeviceSummary[];
  slotOf: (deviceId: string) => number;
}

const perDevice = 15;
const shown = 12;

/** Its heading's id: search leads to it (`/settings/devices#uploads`). */
const uploadsAnchor = "uploads";
const footer = "Each request from the phones, newest first.";

/**
 * Every upload the phones made, newest first: the recent ingest log of each
 * device, plus uploads announced live while this page is open (highlighted).
 * Settings › Devices' proof that data keeps arriving.
 */
export function UploadFeed({ devices, slotOf }: UploadFeedProps) {
  const format = useFormatter();
  const { uploads } = useLiveState();
  // `combine` output is structurally shared, so `logs.entries` only changes when a log does.
  const logs = useQueries({
    queries: devices.map((device) => ingestLogQuery(device.id, perDevice)),
    combine: (results) => ({
      pending: results.some((result) => result.isPending),
      entries: results.map((result, index) => ({
        deviceId: devices[index]?.id ?? "",
        entries: result.data?.entries ?? [],
      })),
    }),
  });
  const pending = logs.pending;
  const feed = useMemo(
    () => mergeUploadFeed(logs.entries, uploads, shown),
    [logs.entries, uploads],
  );
  const names = new Map(devices.map((device) => [device.id, device.name]));

  if (feed.length === 0) {
    return (
      <SettingsGroup title="Uploads" id={uploadsAnchor} variant="card" footer={footer}>
        {pending ? (
          <LoadingBlock label="Loading recent uploads">
            <Skeleton height="2.75rem" />
            <Skeleton height="2.75rem" />
            <Skeleton height="2.75rem" />
          </LoadingBlock>
        ) : (
          <EmptyState icon="upload" title="No uploads yet" level={3}>
            <p>They appear here the moment a phone sends its first batch.</p>
          </EmptyState>
        )}
      </SettingsGroup>
    );
  }
  return (
    <SettingsGroup title="Uploads" id={uploadsAnchor} ordered footer={footer}>
      {feed.map((item) => (
        <li
          key={item.key}
          className={item.live ? "upload-feed__item is-live" : "upload-feed__item"}
        >
          <DeviceSwatch slot={slotOf(item.deviceId)} />
          <div className="upload-feed__text">
            <p className="upload-feed__line">
              <span className="upload-feed__device">
                {names.get(item.deviceId) ?? "Removed device"}
              </span>
              <span className="upload-feed__count">
                {item.inserted === 0 ? "no new points" : `+${format.count(item.inserted)} points`}
              </span>
            </p>
            <p className="upload-feed__meta">
              <RelativeTime value={item.receivedAt} />
              <span aria-hidden="true"> · </span>
              <span>{format.timeWithSeconds(item.receivedAt)}</span>
              {item.duplicates > 0 ? (
                <span> · {format.count(item.duplicates)} already stored</span>
              ) : null}
              {item.rejected > 0 ? (
                <span className="upload-feed__rejected">
                  {" "}
                  · {format.count(item.rejected)} rejected
                </span>
              ) : null}
            </p>
          </div>
          {item.live ? <span className="upload-feed__badge">New</span> : null}
        </li>
      ))}
    </SettingsGroup>
  );
}
