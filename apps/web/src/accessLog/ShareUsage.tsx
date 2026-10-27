import { dataAccessActorId } from "@trail/contracts/dataAccessActorId";
import { useMemo } from "react";
import { BarChart } from "../charts/BarChart";
import { describeBars } from "../charts/summaries";
import { useFormatter } from "../format/useFormatter";
import { useAccessSummary } from "../queries/useAccessSummary";
import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingsRow } from "../settings/SettingsRow";
import { useNow } from "../time/useNow";
import { ErrorState } from "../ui/ErrorState";
import { LoadingBlock } from "../ui/LoadingBlock";
import { Skeleton } from "../ui/Skeleton";
import { actionLabel } from "./accessActions";
import { viewerPath } from "./actorAddress";
import { daysPhrase, usageDays } from "./viewerDays";
import { viewerSentence } from "./viewerSentence";

/** What a live update is, beside the looks: the people channel's names would not do. */
const lookLabel = (action: string): string =>
  action === "live.position" ? "Your new positions, live" : actionLabel(action, "people");

/**
 * What the person of a share looked at, on its page: in the last 30 days, how
 * often and at what — position, history, live updates — and when last, from
 * the data access log. Every look by them counts, through any share.
 */
export function ShareUsage({ userId, name }: { userId: string; name: string }) {
  const format = useFormatter();
  const now = useNow(60_000);
  const actorId = dataAccessActorId({ kind: "person", userId });
  const summary = useAccessSummary({ days: usageDays, actorId });
  const person = summary.data?.people[0];
  const chart = useMemo(() => {
    const rows = (person?.actions ?? []).map(({ action, count }) => ({
      key: action,
      label: lookLabel(action),
      values: [count],
    }));
    return { rows, series: [{ key: "count", label: "Times", tone: "accent" as const }] };
  }, [person]);
  return (
    <>
      <SettingsGroup
        title={`What they looked at in ${daysPhrase(usageDays)}`}
        id="looks"
        variant="card"
      >
        {summary.isPending ? (
          <LoadingBlock label="Loading what they looked at">
            <Skeleton height="10rem" />
          </LoadingBlock>
        ) : summary.isError ? (
          <ErrorState
            title="What they looked at could not be loaded"
            error={summary.error}
            onRetry={() => void summary.refetch()}
            retrying={summary.isFetching}
          />
        ) : person === undefined ? (
          <p className="muted">
            {name} did not look at you in {daysPhrase(usageDays)}.
          </p>
        ) : (
          <>
            <p>{viewerSentence(person, format, now)}</p>
            <BarChart
              title="Looks by what they saw"
              summary={describeBars(chart.rows, chart.series, format.count)}
              series={chart.series}
              rows={chart.rows}
              orientation="horizontal"
              valueLabels
              integer
              formatValue={format.count}
              categoryLabel="What"
            />
          </>
        )}
      </SettingsGroup>
      {person === undefined ? null : (
        <SettingsGroup>
          <SettingsRow kind="link" to={viewerPath(actorId)} label="Their looks, hour by hour" />
        </SettingsGroup>
      )}
    </>
  );
}
