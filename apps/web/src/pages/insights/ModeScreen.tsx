import { useFormatter } from "../../format/useFormatter";
import { useInsightsMode } from "../../queries/useInsightsMode";
import { useInsightsOverview } from "../../queries/useInsightsOverview";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { transportModeInfo } from "../../transport/transportModes";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { heroChange, InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { formatKmh } from "./insightsFormat";
import { modePath } from "./insightsLevels";
import { insightsLink } from "./insightsLinks";
import { periodLabel } from "./insightsPeriod";
import { ModeTrend } from "./ModeTrend";
import { longestFact, modeFamily, roadsFact, speedFact, whenFact } from "./modeFacts";
import { type ModeContext, WithMode } from "./modeRoute";
import { useInsightsComparison } from "./useInsightsComparison";

function Body({ mode, label, state, up }: ModeContext) {
  const format = useFormatter();
  const insights = useInsightsMode(mode, state.query());
  const overview = useInsightsOverview(state.query());
  const comparison = useInsightsComparison(state, overview.data);
  const data = insights.data;
  const none = data !== undefined && data.totals.durationS <= 0 && data.totals.moves === 0;
  const to = (part?: Parameters<typeof modePath>[1]) =>
    insightsLink(modePath(mode, part), state.params);
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
          <SettingsGroup>
            <SettingsRow
              kind="link"
              to={to("time")}
              icon="calendar"
              tone="blue"
              label="When"
              value={whenFact(insights.data, format)}
            />
            {modeFamily(mode) === null ? null : (
              <SettingsRow
                kind="link"
                to={to("roads")}
                icon="route"
                tone="orange"
                label="Roads"
                value={roadsFact(insights.data, format)}
              />
            )}
            <SettingsRow
              kind="link"
              to={to("speed")}
              icon="speed"
              tone="green"
              label="Speed"
              value={speedFact(insights.data, format)}
            />
            <SettingsRow
              kind="link"
              to={to("moves")}
              icon="altitude"
              tone="purple"
              label="Longest moves"
              value={longestFact(insights.data, format)}
            />
          </SettingsGroup>
        </>
      )}
    </InsightsScreen>
  );
}

/**
 * One mode's screen (`/insights/transport/:mode`): its distance against the
 * period before, how it went over the period, and rows to its When, Roads,
 * Speed and Longest moves. Naming a mode Trail does not know asks for nothing.
 */
export function ModeScreen() {
  return <WithMode part={false} render={(context) => <Body {...context} />} />;
}
