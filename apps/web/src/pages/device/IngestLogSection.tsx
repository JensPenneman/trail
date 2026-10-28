import { type DeviceApp, deviceAppInfo } from "@trail/contracts/deviceApp";
import { useId, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useIngestLog } from "../../queries/useIngestLog";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { useScrollableFocus } from "../../ui/useScrollableFocus";

interface IngestLogSectionProps {
  deviceId: string;
  app: DeviceApp;
}

const collapsedRows = 10;

/**
 * Every accepted upload with what it contained — the audit trail that data
 * arrives — on the page of the device's uploads: the latest ten, or all fifty
 * the server keeps at hand.
 */
export function IngestLogSection({ deviceId, app }: IngestLogSectionProps) {
  const format = useFormatter();
  const captionId = useId();
  const scrollable = useScrollableFocus();
  const log = useIngestLog(deviceId, 50);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? (log.data ?? []) : (log.data ?? []).slice(0, collapsedRows);
  return (
    <>
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
        <SettingsGroup variant="card">
          <EmptyState icon="upload" title="No uploads yet">
            <p>
              Once {deviceAppInfo[app].name} sends its first upload, every request is listed here.
            </p>
          </EmptyState>
        </SettingsGroup>
      ) : (
        <SettingsGroup variant="flush">
          <section className="table-scroll" aria-labelledby={captionId} ref={scrollable}>
            <table className="table">
              <caption className="visually-hidden" id={captionId}>
                Uploads of this device
              </caption>
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
          </section>
        </SettingsGroup>
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
    </>
  );
}
