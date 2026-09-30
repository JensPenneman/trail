import type { IngestLogEntry } from "@trail/contracts/ingestLog";
import type { LiveUpload } from "./createLiveStore";

export interface FeedItem {
  key: string;
  deviceId: string;
  receivedAt: string;
  inserted: number;
  duplicates: number;
  rejected: number;
  /** Arrived through the event stream while this page was open. */
  live: boolean;
}

/** The stream's timestamp and the log row's are taken separately on the server. */
const sameUploadToleranceMs = 5000;

/**
 * The upload feed: each device's recent ingest log (so the list is never empty
 * on arrival) plus uploads announced live. A live upload and its log row
 * describe the same request when device, counts and time (within a few
 * seconds) match; the log row wins but keeps the live highlight.
 */
export function mergeUploadFeed(
  logs: readonly { deviceId: string; entries: readonly IngestLogEntry[] }[],
  live: readonly LiveUpload[],
  limit: number,
): FeedItem[] {
  const items: FeedItem[] = [];
  const unmatched = [...live];
  for (const { deviceId, entries } of logs) {
    for (const entry of entries) {
      const time = Date.parse(entry.receivedAt);
      const matchIndex = unmatched.findIndex(
        (upload) =>
          upload.deviceId === deviceId &&
          upload.inserted === entry.locations &&
          upload.duplicates === entry.duplicates &&
          Math.abs(Date.parse(upload.receivedAt) - time) <= sameUploadToleranceMs,
      );
      if (matchIndex !== -1) unmatched.splice(matchIndex, 1);
      items.push({
        key: `log:${deviceId}:${entry.id}`,
        deviceId,
        receivedAt: entry.receivedAt,
        inserted: entry.locations,
        duplicates: entry.duplicates,
        rejected: entry.rejected,
        live: matchIndex !== -1,
      });
    }
  }
  for (const upload of unmatched) {
    items.push({
      key: `live:${upload.deviceId}:${upload.receivedAt}`,
      ...upload,
      live: true,
    });
  }
  return items.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, limit);
}
