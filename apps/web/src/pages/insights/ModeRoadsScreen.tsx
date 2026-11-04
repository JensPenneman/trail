import type { InsightsMode } from "@trail/contracts/insights";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsMode } from "../../queries/useInsightsMode";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { modeFamily, topKind } from "./modeFacts";
import { type ModeContext, WithMode } from "./modeRoute";
import { WayKindBars } from "./WayKindBars";
import { wayKindLabels } from "./wayLabels";

/** The number the screen is about: the share on the way the mode travels on, by family. */
function Hero({ insights }: { insights: InsightsMode }) {
  const format = useFormatter();
  const { mode, roads } = insights;
  const family = modeFamily(mode);
  if (family === "rail" && insights.rail !== null) {
    const halts = insights.stationStops ?? 0;
    const perRide =
      insights.totals.moves > 0
        ? `, ${new Intl.NumberFormat(format.locale, { maximumFractionDigits: 1 }).format(halts / insights.totals.moves)} a ride`
        : "";
    return (
      <InsightsHero
        label="On railway track"
        value={format.percent(insights.rail.share)}
        detail={`${format.count(halts)} ${halts === 1 ? "halt" : "halts"} at ${mode === "tram" ? "tram stops" : "stations"}${perRide}`}
      />
    );
  }
  if (family === "ferry" && insights.ferry !== null) {
    return <InsightsHero label="On ferry routes" value={format.percent(insights.ferry.share)} />;
  }
  const top = topKind(insights);
  return top === null ? null : (
    <InsightsHero
      label={`On ${wayKindLabels[top.kind].toLowerCase()}`}
      value={format.percent(top.share)}
      detail={`of ${format.distance(roads.mappedM)} with map data`}
    />
  );
}

function Body({ mode, label, state, up }: ModeContext) {
  const format = useFormatter();
  const insights = useInsightsMode(mode, state.query());
  const data = insights.data;
  const family = modeFamily(mode);
  return (
    <InsightsScreen
      state={state}
      title="Roads"
      documentTitle={`Roads · ${label} · Insights`}
      up={up}
      pending={data?.pending ?? false}
      updating={insights.isPlaceholderData}
    >
      {insights.isPending ? (
        <LoadingBlock label={`Loading the roads of ${label.toLowerCase()}`}>
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
      ) : family === null ? (
        <div className="card">
          <EmptyState icon="route" title={`No roads for ${label.toLowerCase()}`}>
            <p>This mode is not laid onto roads, railways or ferry routes.</p>
          </EmptyState>
        </div>
      ) : insights.data.roads.distanceM <= 0 ? (
        <div className="card">
          <EmptyState icon="route" title={`No ${label.toLowerCase()} in this period`}>
            <p>Choose another period, or another device.</p>
          </EmptyState>
        </div>
      ) : insights.data.roads.mappedM <= 0 ? (
        <Notice tone="info" title="No map data for these moves">
          <p>
            Trail lays moves onto OpenStreetMap's roads and railways once it has the map of their
            area. It may still be fetching it, or the server works without map data.
          </p>
        </Notice>
      ) : family === "road" && topKind(insights.data) === null ? (
        <Notice tone="info" title="Off the map">
          <p>
            The map data holds no road or path near these moves, so there is no kind of road to
            name.
          </p>
        </Notice>
      ) : (
        <>
          <Hero insights={insights.data} />
          <WayKindBars
            title={family === "road" ? "Distance by kind of road" : "Distance by kind of way"}
            kinds={insights.data.roads.kinds}
            tone={mode}
          />
          {insights.data.roads.mappedM < insights.data.roads.distanceM * 0.995 ? (
            <p className="muted">
              Map data covers{" "}
              {format.percent(insights.data.roads.mappedM / insights.data.roads.distanceM)} of this
              distance; the rest is not counted here.
            </p>
          ) : null}
        </>
      )}
    </InsightsScreen>
  );
}

/** A mode's Roads (`/insights/transport/:mode/roads`): where it went, by kind of way. */
export function ModeRoadsScreen() {
  return <WithMode part render={(context) => <Body {...context} />} />;
}
