import { maxAccessLogLimit } from "@trail/contracts/dataAccess";
import { dataAccessActorId } from "@trail/contracts/dataAccessActorId";
import { useFormatter } from "../format/useFormatter";
import { useAccessSummary } from "../queries/useAccessSummary";
import { useRecentAccess } from "../queries/useRecentAccess";
import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingsRow } from "../settings/SettingsRow";
import { useNow } from "../time/useNow";
import { ErrorState } from "../ui/ErrorState";
import { LoadingBlock } from "../ui/LoadingBlock";
import { Skeleton } from "../ui/Skeleton";
import { AccessSeriesChart } from "./AccessSeriesChart";
import { actionLabel, channelLabels } from "./accessActions";
import { howOftenText } from "./accessLineText";
import { viewerPath } from "./actorAddress";
import { daysPhrase, usageDays } from "./viewerDays";
import { lastText, tokenSentence } from "./viewerSentence";

/**
 * How many of a token's last actions its page lists, from a full page of its
 * newest lines: within an hour the log orders lines by key, not by time, and
 * an actor has at most 200 of them in an hour.
 */
const lastActions = 5;

/**
 * A token's use, on its page: the calls per day of the last 30 days, through
 * the API and through the MCP server apart, and what it did last — from the
 * data access log.
 */
export function TokenUsage({ tokenId }: { tokenId: string }) {
  const format = useFormatter();
  const now = useNow(60_000);
  const actorId = dataAccessActorId({ kind: "token", tokenId });
  const summary = useAccessSummary({ days: usageDays, actorId });
  const recent = useRecentAccess(actorId, maxAccessLogLimit);
  // Within an hour the log orders its lines by key, not by time: the last one first here.
  const last = [...(recent.data ?? [])]
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .slice(0, lastActions);
  const token = summary.data?.tokens[0];
  return (
    <>
      <SettingsGroup title={`Use in ${daysPhrase(usageDays)}`} id="usage" variant="card">
        {summary.isPending ? (
          <LoadingBlock label="Loading the token's use">
            <Skeleton height="14rem" />
          </LoadingBlock>
        ) : summary.isError ? (
          <ErrorState
            title="Its use could not be loaded"
            error={summary.error}
            onRetry={() => void summary.refetch()}
            retrying={summary.isFetching}
          />
        ) : token === undefined ? (
          <p className="muted">Not used in {daysPhrase(usageDays)}.</p>
        ) : (
          <>
            <p>{tokenSentence(token, format, now)}</p>
            <AccessSeriesChart
              title="Calls per day"
              summary={summary.data}
              series={[
                { key: "api", label: "API", tone: "category-1", value: (day) => day.byChannel.api },
                { key: "mcp", label: "MCP", tone: "category-2", value: (day) => day.byChannel.mcp },
              ]}
            />
          </>
        )}
      </SettingsGroup>
      {last.length === 0 ? null : (
        <SettingsGroup title="Last actions">
          {last.map((line) => (
            <SettingsRow
              key={line.id}
              kind="plain"
              label={actionLabel(line.action, line.channel)}
              detail={`${channelLabels[line.channel]} · ${howOftenText(line, format)} · ${lastText(line.lastAt, format, now)}`}
            />
          ))}
          <SettingsRow
            kind="link"
            to={viewerPath(actorId)}
            label="Everything it did, hour by hour"
          />
        </SettingsGroup>
      )}
    </>
  );
}
