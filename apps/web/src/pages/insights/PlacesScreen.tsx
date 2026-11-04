import { useMemo } from "react";
import { BarChart } from "../../charts/BarChart";
import { describeExtremes } from "../../charts/summaries";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsPlaces } from "../../queries/useInsightsPlaces";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { axisFormats } from "./insightsFormat";
import { insightsRootPath } from "./insightsLevels";
import { insightsLink, placeLink } from "./insightsLinks";
import { periodPhrase } from "./insightsPeriod";
import { placeLabel } from "./placeLabel";
import { useInsightsPeriod } from "./useInsightsPeriod";

/** The chart shows the places that stand out; the rows below list them all. */
const chartPlaces = 8;

const visitsText = (visits: number, count: (value: number) => string) =>
  `${count(visits)} ${visits === 1 ? "visit" : "visits"}`;

/**
 * Places (`/insights/places`): where the stops of the period add up — how many
 * places, the time at the top ones as a chart, and every place (fifty at most)
 * as a row that opens it.
 */
export function PlacesScreen() {
  const state = useInsightsPeriod();
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const places = useInsightsPlaces(state.query());
  const data = places.data;
  return (
    <InsightsScreen
      state={state}
      title="Places"
      documentTitle="Places · Insights"
      up={{ to: insightsLink(insightsRootPath, state.params), label: "Insights", always: false }}
      pending={data?.pending ?? false}
      updating={places.isPlaceholderData}
    >
      {places.isPending ? (
        <LoadingBlock label="Loading places">
          <Skeleton height="6rem" />
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : places.isError ? (
        <ErrorState
          title="Insights could not be loaded"
          error={places.error}
          onRetry={() => void places.refetch()}
          retrying={places.isFetching}
        />
      ) : places.data.totals.places === 0 ? (
        <div className="card">
          <EmptyState icon="pin" title={`No stops in ${periodPhrase(state.period, format)}`}>
            <p>Choose another period, or another device.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <InsightsHero
            label="Places"
            value={format.count(places.data.totals.places)}
            detail={`${visitsText(places.data.totals.visits, format.count)} · ${format.duration(places.data.totals.durationS)}`}
          />
          <PlacesChart data={places.data} axes={axes} />
          <SettingsGroup
            footer={
              places.data.rest.places === 0
                ? undefined
                : `and ${format.count(places.data.rest.places)} more ${places.data.rest.places === 1 ? "place" : "places"}, ${format.duration(places.data.rest.durationS)}`
            }
          >
            {places.data.places.map((place) => {
              const label = placeLabel(place, format);
              return (
                <SettingsRow
                  key={place.key}
                  kind="link"
                  to={placeLink("/insights/place", state.params, place.key)}
                  label={label.title}
                  {...(label.detail === null ? {} : { detail: label.detail })}
                  value={`${format.duration(place.durationS)} · ${visitsText(place.visits, format.count)}`}
                />
              );
            })}
          </SettingsGroup>
        </>
      )}
    </InsightsScreen>
  );
}

function PlacesChart({
  data,
  axes,
}: {
  data: NonNullable<ReturnType<typeof useInsightsPlaces>["data"]>;
  axes: ReturnType<typeof axisFormats>;
}) {
  const format = useFormatter();
  const rows = data.places.slice(0, chartPlaces).map((place) => ({
    key: place.key,
    label: placeLabel(place, format).title,
    values: [place.durationS],
  }));
  return (
    <BarChart
      title="Time at your top places"
      summary={describeExtremes(
        rows.map((row) => ({ label: row.label, value: row.values[0] ?? 0 })),
        format.duration,
      )}
      series={[{ key: "time", label: "Time", tone: "accent" }]}
      rows={rows}
      orientation="horizontal"
      valueLabels
      formatValue={format.duration}
      formatTick={axes.duration}
      categoryLabel="Place"
    />
  );
}
