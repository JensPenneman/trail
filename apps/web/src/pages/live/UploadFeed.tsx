import { useQueries } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { useId, useMemo } from "react";
import { useFormatter } from "../../format/useFormatter";
import { mergeUploadFeed } from "../../live/mergeUploadFeed";
import { useLiveState } from "../../live/useLiveState";
import { ingestLogQuery } from "../../queries/ingestLogQuery";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { PlainList } from "../../ui/PlainList";
import { RelativeTime } from "../../ui/RelativeTime";
import { Skeleton } from "../../ui/Skeleton";
import "./UploadFeed.css";

interface UploadFeedProps {
  devices: readonly DeviceSummary[];
  slotOf: (deviceId: string) => number;
}

const perDevice = 15;
const shown = 12;

/**
 * Every upload the phones made, newest first: the recent ingest log of each
 * device, plus uploads announced live while this page is open (highlighted).
 */
export function UploadFeed({ devices, slotOf }: UploadFeedProps) {
  const format = useFormatter();
  const headingId = useId();
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

  return (
    <section className="section upload-feed" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Uploads
        </h2>
        <p className="section__description">Each request from Overland, newest first.</p>
      </div>
      {pending && feed.length === 0 ? (
        <LoadingBlock label="Loading recent uploads">
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
          <Skeleton height="2.75rem" />
        </LoadingBlock>
      ) : feed.length === 0 ? (
        <div className="card">
          <EmptyState icon="upload" title="No uploads yet" level={3}>
            <p>They appear here the moment a phone sends its first batch.</p>
          </EmptyState>
        </div>
      ) : (
        <PlainList ordered className="upload-feed__list card card--flush">
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
                    {item.inserted === 0
                      ? "no new points"
                      : `+${format.count(item.inserted)} points`}
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
        </PlainList>
      )}
    </section>
  );
}
