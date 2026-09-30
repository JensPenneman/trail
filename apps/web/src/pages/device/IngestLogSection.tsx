import { useId, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useIngestLog } from "../../queries/useIngestLog";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";

interface IngestLogSectionProps {
  deviceId: string;
}

const collapsedRows = 10;

/** Every accepted upload with what it contained — the audit trail that data arrives. */
export function IngestLogSection({ deviceId }: IngestLogSectionProps) {
  const format = useFormatter();
  const headingId = useId();
  const log = useIngestLog(deviceId, 50);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? (log.data ?? []) : (log.data ?? []).slice(0, collapsedRows);
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Uploads
        </h2>
        <p className="section__description">Requests from the phone, newest first.</p>
      </div>
      {log.isPending ? (
        <LoadingBlock label="Loading uploads">
          <Skeleton height="12rem" />
        </LoadingBlock>
      ) : log.isError ? (
        <ErrorState
          title="Uploads could not be loaded"
          error={log.error}
          onRetry={() => void log.refetch()}
          retrying={log.isFetching}
        />
      ) : log.data.length === 0 ? (
        <div className="card">
          <EmptyState icon="upload" title="No uploads yet" level={3}>
            <p>Once Overland sends its first batch, every request is listed here.</p>
          </EmptyState>
        </div>
      ) : (
        <div className="card card--flush table-scroll">
          <table className="table">
            <caption className="visually-hidden">Uploads of this device</caption>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col" className="table__number">
                  Records
                </th>
                <th scope="col" className="table__number">
                  New points
                </th>
                <th scope="col" className="table__number">
                  Already stored
                </th>
                <th scope="col" className="table__number">
                  Visits
                </th>
                <th scope="col" className="table__number">
                  Trips
                </th>
                <th scope="col" className="table__number">
                  Events
                </th>
                <th scope="col" className="table__number">
                  Rejected
                </th>
                <th scope="col" className="table__number">
                  Took
                </th>
                <th scope="col">App</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <time dateTime={entry.receivedAt}>
                      {format.dateTimeCompact(entry.receivedAt)}
                    </time>
                  </td>
                  <td className="table__number">{format.count(entry.records)}</td>
                  <td className="table__number">{format.count(entry.locations)}</td>
                  <td className="table__number">{format.count(entry.duplicates)}</td>
                  <td className="table__number">{format.count(entry.visits)}</td>
                  <td className="table__number">{format.count(entry.trips)}</td>
                  <td className="table__number">{format.count(entry.events)}</td>
                  <td
                    className={
                      entry.rejected > 0 ? "table__number table__warning" : "table__number"
                    }
                  >
                    {format.count(entry.rejected)}
                  </td>
                  <td className="table__number">{format.count(entry.durationMs)} ms</td>
                  <td className="table__muted">{entry.userAgent ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.data !== undefined && log.data.length > collapsedRows ? (
        <div className="cluster">
          <Button
            icon={expanded ? "chevronUp" : "chevronDown"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show the latest 10" : `Show all ${log.data.length}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
