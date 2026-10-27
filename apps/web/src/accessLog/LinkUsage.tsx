import { dataAccessActorId } from "@trail/contracts/dataAccessActorId";
import { StatTile } from "../charts/StatTile";
import { StatTiles } from "../charts/StatTiles";
import { useFormatter } from "../format/useFormatter";
import { useAccessSummary } from "../queries/useAccessSummary";
import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingsRow } from "../settings/SettingsRow";
import { useNow } from "../time/useNow";
import { ErrorState } from "../ui/ErrorState";
import { LoadingBlock } from "../ui/LoadingBlock";
import { Skeleton } from "../ui/Skeleton";
import { AccessSeriesChart } from "./AccessSeriesChart";
import { viewerPath } from "./actorAddress";
import { daysPhrase, usageDays } from "./viewerDays";

/**
 * A public link's views, on its page: how often it was opened in the last 30
 * days and by how many distinct visitors, per day — from the data access log.
 */
export function LinkUsage({ linkId }: { linkId: string }) {
  const format = useFormatter();
  const now = useNow(60_000);
  const actorId = dataAccessActorId({ kind: "link", linkId });
  const summary = useAccessSummary({ days: usageDays, actorId });
  const link = summary.data?.links[0];
  return (
    <>
      <SettingsGroup title={`Views in ${daysPhrase(usageDays)}`} id="views" variant="card">
        {summary.isPending ? (
          <LoadingBlock label="Loading the link's views">
            <Skeleton height="14rem" />
          </LoadingBlock>
        ) : summary.isError ? (
          <ErrorState
            title="Its views could not be loaded"
            error={summary.error}
            onRetry={() => void summary.refetch()}
            retrying={summary.isFetching}
          />
        ) : link === undefined ? (
          <p className="muted">Not opened in {daysPhrase(usageDays)}.</p>
        ) : (
          <>
            <StatTiles label="Views">
              <StatTile label="Views" icon="eye" value={format.count(link.events)} />
              <StatTile label="Visitors" icon="users" value={format.count(link.visitors)} />
              <StatTile
                label="Last opened"
                icon="history"
                value={format.relative(link.lastAt, now)}
              />
            </StatTiles>
            <AccessSeriesChart
              title="Views per day"
              summary={summary.data}
              series={[
                { key: "link", label: "Views", tone: "accent", value: (day) => day.byChannel.link },
              ]}
            />
          </>
        )}
      </SettingsGroup>
      {link === undefined ? null : (
        <SettingsGroup footer="A visitor is one network and one kind of browser: never an address.">
          <SettingsRow kind="link" to={viewerPath(actorId)} label="Its visitors, hour by hour" />
        </SettingsGroup>
      )}
    </>
  );
}
