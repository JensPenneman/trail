import { type TransportMode, transportModes } from "@trail/contracts/transport";
import { useParams } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsMode } from "../../queries/useInsightsMode";
import { useInsightsOverview } from "../../queries/useInsightsOverview";
import { transportModeInfo } from "../../transport/transportModes";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { heroChange, InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { formatKmh } from "./insightsFormat";
import { insightsRootPath } from "./insightsLevels";
import { insightsLink } from "./insightsLinks";
import { periodLabel } from "./insightsPeriod";
import { ModeTrend } from "./ModeTrend";
import { useInsightsComparison } from "./useInsightsComparison";
import { useInsightsPeriod } from "./useInsightsPeriod";

const isMode = (value: string | undefined): value is TransportMode =>
  (transportModes as readonly (string | undefined)[]).includes(value);

/**
 * One mode's screen (`/insights/transport/:mode`): its distance against the
 * period before, and how it went over the period. Naming a mode Trail does
 * not know asks for nothing.
 */
export function ModeScreen() {
  const { mode: param } = useParams();
  const mode = isMode(param) ? param : null;
  const state = useInsightsPeriod();
  const format = useFormatter();
  const insights = useInsightsMode(mode, state.query());
  const overview = useInsightsOverview(state.query(), { enabled: mode !== null });
  const comparison = useInsightsComparison(state, overview.data, { enabled: mode !== null });
  const label = mode === null ? "Unknown mode" : transportModeInfo[mode].label;
  const up = { to: insightsLink(insightsRootPath, state.params), label: "Insights", always: false };

  if (mode === null) {
    return (
      <InsightsScreen
        state={state}
        title={label}
        documentTitle="Insights"
        up={up}
        pending={false}
        updating={false}
        periodBar={false}
      >
        <div className="card">
          <EmptyState
            icon="unknown"
            title="No such mode"
            action={
              <LinkButton to={up.to} icon="insights">
                Back to Insights
              </LinkButton>
            }
          >
            <p>The address names a transport mode Trail does not know.</p>
          </EmptyState>
        </div>
      </InsightsScreen>
    );
  }

  const data = insights.data;
  const none = data !== undefined && data.totals.durationS <= 0 && data.totals.moves === 0;
  return (
    <InsightsScreen
      state={state}
      title={label}
      documentTitle={`${label} · Insights`}
      up={up}
      pending={data?.pending ?? false}
      updating={insights.isPlaceholderData}
      announcement={
        data === undefined || insights.isPlaceholderData
          ? null
          : `${periodLabel(state.period, format)}: ${format.distance(data.totals.distanceM)}`
      }
    >
      {insights.isPending ? (
        <LoadingBlock label={`Loading ${label.toLowerCase()}`}>
          <Skeleton height="6rem" />
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : insights.isError ? (
        <ErrorState
          title="Insights could not be loaded"
          error={insights.error}
          onRetry={() => void insights.refetch()}
          retrying={insights.isFetching}
        />
      ) : none ? (
        <>
          <InsightsHero
            label="Distance"
            value={format.distance(0)}
            change={heroChange(comparison, 0, comparison?.modeDistanceM(mode) ?? 0, format)}
          />
          <div className="card">
            <EmptyState
              icon={transportModeInfo[mode].icon}
              title={`No ${label.toLowerCase()} in this period`}
            >
              <p>Choose another period, or another device.</p>
            </EmptyState>
          </div>
        </>
      ) : (
        <>
          <InsightsHero
            label="Distance"
            value={format.distance(insights.data.totals.distanceM)}
            detail={[
              format.duration(insights.data.totals.durationS),
              `${format.count(insights.data.totals.moves)} ${insights.data.totals.moves === 1 ? "move" : "moves"}`,
              insights.data.totals.typicalSpeedKmh === null
                ? null
                : `typically ${formatKmh(format, insights.data.totals.typicalSpeedKmh)}`,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
            change={heroChange(
              comparison,
              insights.data.totals.distanceM,
              comparison?.modeDistanceM(mode) ?? 0,
              format,
            )}
          />
          <ModeTrend insights={insights.data} />
        </>
      )}
    </InsightsScreen>
  );
}
