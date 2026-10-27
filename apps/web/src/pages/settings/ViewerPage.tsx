import { parseDataAccessActorId } from "@trail/contracts/dataAccessActorId";
import { useId } from "react";
import { useParams } from "react-router";
import { AccessLines } from "../../accessLog/AccessLines";
import { AccessSeriesChart } from "../../accessLog/AccessSeriesChart";
import { actorIdOfSegment } from "../../accessLog/actorAddress";
import { actorPage } from "../../accessLog/actorPage";
import { PeriodChoice } from "../../accessLog/PeriodChoice";
import { useResourceNames } from "../../accessLog/useResourceNames";
import { daysPhrase, periodStart, useViewerDays } from "../../accessLog/viewerDays";
import type { AccessLogParams } from "../../api/queryKeys";
import { useSessionUser } from "../../app/useSessionUser";
import { useFormatter } from "../../format/useFormatter";
import { useAccessSummary } from "../../queries/useAccessSummary";
import { useShares } from "../../queries/useShares";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { useNow } from "../../time/useNow";
import { useToday } from "../../time/useToday";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { MissingItem } from "./MissingItem";
import "./ViewersPage.css";

/** The page of one actor whose id the address holds. */
function ActorViewerPage({ actorId }: { actorId: string }) {
  const ref = parseDataAccessActorId(actorId);
  const format = useFormatter();
  const now = useNow(60_000);
  const today = useToday();
  const { timezone } = useSessionUser();
  const linesId = useId();
  const [days, setDays] = useViewerDays();
  const names = useResourceNames();
  const shares = useShares().data ?? [];
  const summary = useAccessSummary({ days, actorId });
  if (ref === null) return null;
  const page = actorPage(ref, summary.data, { names, shares, days, format, now });
  const params: AccessLogParams = {
    actor: null,
    channel: null,
    action: null,
    from: periodStart(today, days, timezone),
    actorId,
  };
  return (
    <SettingsPage parent="viewers" title={page.title} description={page.kind}>
      <div className="viewers__controls">
        <PeriodChoice days={days} onChange={setDays} />
      </div>
      {summary.isPending ? (
        <LoadingBlock label="Loading what they did">
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : summary.isError && summary.data === undefined ? (
        <ErrorState
          title="This could not be loaded"
          error={summary.error}
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      ) : (
        <div className="viewers__content" aria-busy={summary.isPlaceholderData}>
          <SettingsGroup variant="card">
            <p className="viewer__sentence">{page.sentence}</p>
            {summary.data === undefined || summary.data.totals.events === 0 ? null : (
              <AccessSeriesChart
                title={page.chart.title}
                summary={summary.data}
                series={page.chart.series}
              />
            )}
          </SettingsGroup>
        </div>
      )}
      <section className="viewers__lines" aria-labelledby={linesId}>
        <h2 className="viewers__lines-title" id={linesId}>
          Hour by hour
        </h2>
        <AccessLines
          params={params}
          showActor={false}
          names={names}
          headingLevel={3}
          empty={
            <SettingsGroup variant="card">
              <EmptyState icon="history" title={`Nothing in ${daysPhrase(days)}`} level={3}>
                <p>Choose a longer period to see more.</p>
              </EmptyState>
            </SettingsGroup>
          }
        />
      </section>
      {page.related === null ? null : (
        <SettingsGroup>
          <SettingsRow
            kind="link"
            to={page.related.to}
            label={page.related.label}
            detail={page.related.detail}
          />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}

/**
 * Settings › Who viewed you › one of them: a person, a public link, an API
 * token or one of your browsers — what they did in the period, per day, and
 * hour by hour what they read, each line opening to the devices, period,
 * level and precision it was about.
 */
export function ViewerPage() {
  const { actor = "" } = useParams();
  const actorId = actorIdOfSegment(actor);
  if (actorId === null) return <MissingItem parent="viewers" item="Viewer" />;
  return <ActorViewerPage key={actorId} actorId={actorId} />;
}
