import { useFormatter } from "../../format/useFormatter";
import { useInsightsMode } from "../../queries/useInsightsMode";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { formatKmh } from "./insightsFormat";
import { moveOnMap } from "./insightsLinks";
import { moveDay } from "./modeFacts";
import { type ModeContext, WithMode } from "./modeRoute";
import { SpeedHistogram } from "./SpeedHistogram";

function Body({ mode, label, state, up }: ModeContext) {
  const format = useFormatter();
  const insights = useInsightsMode(mode, state.query());
  const data = insights.data;
  const lower = label.toLowerCase();
  const fastest = data?.totals.fastest ?? null;
  return (
    <InsightsScreen
      state={state}
      title="Speed"
      documentTitle={`Speed · ${label} · Insights`}
      up={up}
      pending={data?.pending ?? false}
      updating={insights.isPlaceholderData}
    >
      {insights.isPending ? (
        <LoadingBlock label={`Loading the speed of ${lower}`}>
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
      ) : insights.data.totals.moves === 0 ? (
        <div className="card">
          <EmptyState icon="speed" title={`No ${lower} in this period`}>
            <p>Choose another period, or another device.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <InsightsHero
            label="Typical speed"
            value={
              insights.data.totals.typicalSpeedKmh === null
                ? "—"
                : formatKmh(format, insights.data.totals.typicalSpeedKmh)
            }
            detail={`Average ${formatKmh(format, insights.data.totals.avgSpeedKmh)}`}
          />
          <SpeedHistogram insights={insights.data} />
          {fastest === null ? null : (
            <SettingsGroup title="Fastest">
              <SettingsRow
                kind="away"
                to={moveOnMap(fastest, insights.data.timezone)}
                icon="speed"
                tone="gray"
                label="Fastest move"
                value={`${formatKmh(format, fastest.maxSpeedKmh)} top · ${moveDay(fastest.startedAt, format)}`}
              />
            </SettingsGroup>
          )}
        </>
      )}
    </InsightsScreen>
  );
}

/** A mode's Speed (`/insights/transport/:mode/speed`): how fast it mostly went, and the fastest move. */
export function ModeSpeedScreen() {
  return <WithMode part render={(context) => <Body {...context} />} />;
}
