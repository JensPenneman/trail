import { useId, useMemo } from "react";
import { BarChart } from "../../charts/BarChart";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsRoads } from "../../queries/useInsightsRoads";
import { transportModeInfo } from "../../transport/transportModes";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsFrame } from "./InsightsFrame";
import { axisFormats } from "./insightsFormat";
import { periodPhrase } from "./insightsSearch";
import { ModeSwitch } from "./ModeSwitch";
import { useInsightsSearch } from "./useInsightsSearch";
import { WayKindBars } from "./WayKindBars";
import { wayFamilyLabels } from "./wayLabels";

/**
 * Roads (`/insights/roads`): the kinds of road and railway travelled on, from
 * the map matching of the moves, for every mode or the one chosen.
 */
export function InsightsRoadsPage() {
  const state = useInsightsSearch();
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const kindsId = useId();
  const familiesId = useId();
  const roads = useInsightsRoads(state.query(true));
  const data = roads.data;
  const mode = state.search.mode;
  const tone = mode ?? "accent";

  return (
    <InsightsFrame
      state={state}
      title="Roads"
      documentTitle="Roads · Insights"
      description={`The roads and railways you travelled on${mode === null ? "" : ` by ${transportModeInfo[mode].label.toLowerCase()}`}, in ${periodPhrase(state.search, format)}.`}
      filter={<ModeSwitch value={mode} modes={data?.modes ?? []} onChange={state.chooseMode} />}
      pending={data?.pending ?? false}
      updating={roads.isPlaceholderData}
    >
      {roads.isPending ? (
        <LoadingBlock label="Loading roads">
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
            <p>Choose a longer period, another mode or another device.</p>
          </EmptyState>
        </div>
      ) : roads.data.mappedM <= 0 ? (
        <Notice tone="info" title="No map data for these moves">
          <p>
            Trail lays moves onto OpenStreetMap's roads and railways once it has the map of their
            area. It may still be fetching it, or this server works without map data.
          </p>
        </Notice>
      ) : (
        <>
          <section className="section" aria-labelledby={kindsId}>
            <h2 className="section__title" id={kindsId}>
              By kind of way
            </h2>
            <WayKindBars title="Distance by kind of way" kinds={roads.data.kinds} tone={tone} />
          </section>
          <section className="section" aria-labelledby={familiesId}>
            <h2 className="section__title" id={familiesId}>
              In groups
            </h2>
            <BarChart
              title="Distance by group of ways"
              summary={`${format.distance(roads.data.mappedM)} with map data, of ${format.distance(roads.data.distanceM)} in all.`}
              series={[{ key: "distance", label: "Distance", tone }]}
              rows={roads.data.families.map((row) => ({
                key: row.family,
                label: wayFamilyLabels[row.family],
                values: [row.distanceM],
              }))}
              orientation="horizontal"
              valueLabels
              formatValue={(metres) =>
                `${format.distance(metres)} · ${format.percent(roads.data.mappedM > 0 ? metres / roads.data.mappedM : 0)}`
              }
              formatTick={axes.distance}
              categoryLabel="Group of ways"
            />
          </section>
          {roads.data.mappedM < roads.data.distanceM * 0.995 ? (
            <p className="muted">
              Map data covers {format.percent(roads.data.mappedM / roads.data.distanceM)} of this
              distance; the rest is not counted here.
            </p>
          ) : null}
        </>
      )}
    </InsightsFrame>
  );
}
