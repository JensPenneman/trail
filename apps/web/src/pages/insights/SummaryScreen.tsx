import { useFormatter } from "../../format/useFormatter";
import { useInsightsOverview } from "../../queries/useInsightsOverview";
import { sideBySide } from "../../settings/sideBySide";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { heroChange, InsightsHero } from "./InsightsHero";
import { InsightsList } from "./InsightsList";
import { InsightsScreen } from "./InsightsScreen";
import { periodLabel, periodPhrase } from "./insightsPeriod";
import { ModeSeriesChart } from "./ModeSeriesChart";
import { useInsightsComparison } from "./useInsightsComparison";
import { useInsightsPeriod } from "./useInsightsPeriod";

/**
 * Insights' summary (`/insights`): how the signed-in person travelled in a
 * period — the distance against the period before, and how it went over the
 * period, stacked by mode. On phones the list of the other screens follows.
 */
export function SummaryScreen() {
  const state = useInsightsPeriod();
  const format = useFormatter();
  const wide = useMediaQuery(sideBySide);
  const overview = useInsightsOverview(state.query());
  const data = overview.data;
  // The comparison belongs to the period the answer is of, not to the one it is replacing.
  const comparison = useInsightsComparison(state, overview.isPlaceholderData ? undefined : data);
  const moves = data?.totals.moves ?? 0;
  return (
    <InsightsScreen
      state={state}
      title="Insights"
      documentTitle="Insights"
      up={null}
      pending={data?.pending ?? false}
      updating={overview.isPlaceholderData}
      announcement={
        data === undefined || overview.isPlaceholderData
          ? null
          : `${periodLabel(state.period, format)}: ${format.distance(data.totals.distanceM)}`
      }
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
      ) : overview.data.modes.length === 0 ? (
        <div className="card">
          <EmptyState icon="insights" title={`No moves in ${periodPhrase(state.period, format)}`}>
            <p>
              Moves appear here once your phone's points of the period have arrived and been worked
              out. Choose another period, or another device.
            </p>
          </EmptyState>
        </div>
      ) : (
        <>
          <InsightsHero
            label="Distance"
            value={format.distance(overview.data.totals.distanceM)}
            detail={`${format.duration(overview.data.totals.durationS)} on the move · ${format.count(moves)} ${moves === 1 ? "move" : "moves"}${state.period.kind === "all" ? ` · since ${format.date(overview.data.period.from)}` : ""}`}
            change={heroChange(
              comparison,
              overview.data.totals.distanceM,
              comparison?.totals.distanceM ?? 0,
              format,
            )}
          />
          <ModeSeriesChart overview={overview.data} />
        </>
      )}
      {wide ? null : <InsightsList placement="root" />}
    </InsightsScreen>
  );
}
