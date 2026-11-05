import { useFormatter } from "../../format/useFormatter";
import { useInsightsRoads } from "../../queries/useInsightsRoads";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { insightsRootPath } from "./insightsLevels";
import { insightsLink } from "./insightsLinks";
import { useInsightsPeriod } from "./useInsightsPeriod";
import { WayKindBars } from "./WayKindBars";
import { wayKindLabels } from "./wayLabels";

/**
 * Roads (`/insights/roads`): the kinds of road and railway travelled on, from
 * the map matching of the moves, under the kind with the most distance.
 */
export function RoadsScreen() {
  const state = useInsightsPeriod();
  const format = useFormatter();
  const roads = useInsightsRoads(state.query());
  const data = roads.data;
  const top = data?.kinds
    .filter((entry) => entry.kind !== "other")
    .reduce<(typeof data.kinds)[number] | null>(
      (best, entry) => (best === null || entry.distanceM > best.distanceM ? entry : best),
      null,
    );

  return (
    <InsightsScreen
      state={state}
      title="Roads"
      documentTitle="Roads · Insights"
      up={{ to: insightsLink(insightsRootPath, state.params), label: "Insights", always: false }}
      pending={data?.pending ?? false}
      updating={roads.isPlaceholderData}
    >
      {roads.isPending ? (
        <LoadingBlock label="Loading roads">
          <Skeleton height="6rem" />
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : roads.isError ? (
        <ErrorState
          title="Insights could not be loaded"
          error={roads.error}
          onRetry={() => void roads.refetch()}
          retrying={roads.isFetching}
        />
      ) : roads.data.distanceM <= 0 ? (
        <div className="card">
          <EmptyState icon="route" title="No moves in this period">
            <p>Choose another period, or another device.</p>
          </EmptyState>
        </div>
      ) : roads.data.mappedM > 0 && (top === null || top === undefined) ? (
        <Notice tone="info" title="Off the map">
          <p>
            The map data holds no road or railway near these moves, so there is no kind of way to
            name.
          </p>
        </Notice>
      ) : roads.data.mappedM <= 0 || top === null || top === undefined ? (
        <Notice tone="info" title="No map data for these moves">
          <p>
            Trail lays moves onto OpenStreetMap's roads and railways once it has the map of their
            area. It may still be fetching it, or this server works without map data.
          </p>
        </Notice>
      ) : (
        <>
          <InsightsHero
            label={`On ${wayKindLabels[top.kind].toLowerCase()}`}
            value={format.percent(top.share)}
            detail={`of ${format.distance(roads.data.mappedM)} with map data`}
          />
          <WayKindBars title="Distance by kind of way" kinds={roads.data.kinds} tone="accent" />
          {roads.data.mappedM < roads.data.distanceM * 0.995 ? (
            <p className="muted">
              Map data covers {format.percent(roads.data.mappedM / roads.data.distanceM)} of this
              distance; the rest is not counted here.
            </p>
          ) : null}
        </>
      )}
    </InsightsScreen>
  );
}
