import { useId } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useLocationPages } from "../../queries/useLocationPages";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { Skeleton } from "../../ui/Skeleton";

interface RawPointsSectionProps {
  deviceId: string;
  /** The device's last upload, to notice points that arrived after the list was loaded. */
  lastSeenAt: string | null;
}

/** The stored points exactly as they arrived, newest first, a page at a time. */
export function RawPointsSection({ deviceId, lastSeenAt }: RawPointsSectionProps) {
  const format = useFormatter();
  const headingId = useId();
  const pages = useLocationPages(deviceId);
  const rows = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const newer =
    lastSeenAt !== null && pages.dataUpdatedAt > 0 && Date.parse(lastSeenAt) > pages.dataUpdatedAt;
  const orDash = (value: number | null, render: (value: number) => string) =>
    value === null ? "—" : render(value);

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Raw points
        </h2>
        <p className="section__description">Every stored point, newest first.</p>
      </div>
      {newer ? (
        <Notice
          tone="info"
          title="New points arrived"
          action={
            <Button icon="refresh" busy={pages.isRefetching} onClick={() => void pages.refetch()}>
              Refresh list
            </Button>
          }
        />
      ) : null}
      {pages.isPending ? (
        <LoadingBlock label="Loading points">
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : pages.isError ? (
        <ErrorState
          title="Points could not be loaded"
          error={pages.error}
          onRetry={() => void pages.refetch()}
          retrying={pages.isFetching}
        />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState icon="pin" title="No points stored" level={3} />
        </div>
      ) : (
        <>
          <div className="card card--flush table-scroll">
            <table className="table">
              <caption className="visually-hidden">Stored points of this device</caption>
              <thead>
                <tr>
                  <th scope="col">Recorded</th>
                  <th scope="col">Position</th>
                  <th scope="col" className="table__number">
                    Accuracy
                  </th>
                  <th scope="col" className="table__number">
                    Speed
                  </th>
                  <th scope="col" className="table__number">
                    Altitude
                  </th>
                  <th scope="col">Motion</th>
                  <th scope="col" className="table__number">
                    Battery
                  </th>
                  <th scope="col">Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.recordedAt}>
                    <td>
                      <time dateTime={row.recordedAt}>
                        {format.dateTimeCompact(row.recordedAt)}
                      </time>
                    </td>
                    <td>{format.coordinates(row.lat, row.lon, 5)}</td>
                    <td className="table__number">{orDash(row.accuracy, format.accuracy)}</td>
                    <td className="table__number">{orDash(row.speed, format.speed)}</td>
                    <td className="table__number">{orDash(row.altitude, format.metres)}</td>
                    <td>{row.motion.length === 0 ? "—" : row.motion.join(", ")}</td>
                    <td className="table__number">{orDash(row.batteryLevel, format.percent)}</td>
                    <td className="table__muted">{format.timeWithSeconds(row.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cluster">
            {pages.hasNextPage ? (
              <Button
                icon="chevronDown"
                busy={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                Load older points
              </Button>
            ) : (
              <p className="muted">That is every stored point.</p>
            )}
            <p className="muted" role="status">
              {format.count(rows.length)} shown
            </p>
          </div>
        </>
      )}
    </section>
  );
}
