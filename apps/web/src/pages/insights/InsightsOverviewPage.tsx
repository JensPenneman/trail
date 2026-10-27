import { useId } from "react";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsOverview } from "../../queries/useInsightsOverview";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsFrame } from "./InsightsFrame";
import { comparisonPhrase, periodPhrase } from "./insightsSearch";
import { ModeBreakdown } from "./ModeBreakdown";
import { ModeSeriesChart } from "./ModeSeriesChart";
import { ModeTable } from "./ModeTable";
import { OverviewTiles } from "./OverviewTiles";
import { useInsightsSearch } from "./useInsightsSearch";
import { WhoViewedYouCard } from "./WhoViewedYouCard";

/**
 * Insights' overview (`/insights`): how the signed-in person travelled in a
 * period — the totals against the period before, the modes' parts, a series
 * stacked by mode and a table that opens each mode's page — and who viewed
 * them in the last 30 days.
 */
export function InsightsOverviewPage() {
  const state = useInsightsSearch();
  const format = useFormatter();
  const totalsId = useId();
  const transportId = useId();
  const overview = useInsightsOverview(state.query());
  const data = overview.data;
  // All of the history has nothing before it; an empty period before has nothing to compare.
  const compare =
    data !== undefined &&
    state.search.period !== "all" &&
    data.previous.totals.moves + data.previous.totals.stops > 0;

  return (
    <InsightsFrame
      state={state}
      title="Insights"
      documentTitle="Insights"
      description={`How you travelled in ${periodPhrase(state.search, format)}.`}
      pending={data?.pending ?? false}
      updating={overview.isPlaceholderData}
    >
      {overview.isPending ? (
        <LoadingBlock label="Loading insights">
          <Skeleton height="6rem" />
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : overview.isError ? (
        <ErrorState
          title="Insights could not be loaded"
          error={overview.error}
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : (
        <>
          <section className="section" aria-labelledby={totalsId}>
            <h2 className="visually-hidden" id={totalsId}>
              Totals
            </h2>
            <OverviewTiles overview={overview.data} compare={compare} />
          </section>
          <section className="section" aria-labelledby={transportId}>
            <div className="section__header">
              <h2 className="section__title" id={transportId}>
                Transport
              </h2>
            </div>
            {overview.data.modes.length === 0 ? (
              <div className="card">
                <EmptyState icon="insights" title="No moves in this period" level={3}>
                  <p>
                    Moves appear here once your phone's points of the period have arrived and been
                    worked out. Choose a longer period, or another device.
                  </p>
                </EmptyState>
              </div>
            ) : (
              <>
                <ModeBreakdown modes={overview.data.modes} />
                <ModeSeriesChart overview={overview.data} />
                <ModeTable
                  modes={overview.data.modes}
                  params={state.params}
                  compared={compare ? comparisonPhrase(overview.data.period.days) : null}
                />
              </>
            )}
          </section>
          <WhoViewedYouCard />
        </>
      )}
    </InsightsFrame>
  );
}
