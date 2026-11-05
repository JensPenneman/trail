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

function Body({ mode, label, state, up }: ModeContext) {
  const format = useFormatter();
  const insights = useInsightsMode(mode, state.query());
  const data = insights.data;
  const lower = label.toLowerCase();
  const longest = data?.topMoves.longest ?? [];
  const first = longest[0];
  return (
    <InsightsScreen
      state={state}
      title="Longest moves"
      documentTitle={`Longest moves · ${label} · Insights`}
      up={up}
      pending={data?.pending ?? false}
      updating={insights.isPlaceholderData}
    >
      {insights.isPending ? (
        <LoadingBlock label={`Loading the longest moves by ${lower}`}>
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
      ) : first === undefined ? (
        <div className="card">
          <EmptyState icon="route" title={`No ${lower} in this period`}>
            <p>Choose another period, or another device.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <InsightsHero
            label="Longest move"
            value={format.distance(first.distanceM)}
            detail={moveDay(first.startedAt, format)}
          />
          <SettingsGroup title="The longest">
            {longest.map((move) => (
              <SettingsRow
                key={move.segmentId}
                kind="away"
                to={moveOnMap(move, insights.data.timezone)}
                label={format.dayTime(move.startedAt)}
                value={`${format.distance(move.distanceM)} · ${format.duration(move.durationS)} · ${formatKmh(format, move.avgSpeedKmh)} average`}
              />
            ))}
          </SettingsGroup>
        </>
      )}
    </InsightsScreen>
  );
}

/** A mode's Longest moves (`/insights/transport/:mode/moves`): five moves, each opening its day in History. */
export function LongestMovesScreen() {
  return <WithMode part render={(context) => <Body {...context} />} />;
}
