import { useMemo } from "react";
import { BarChart } from "../../charts/BarChart";
import { describeExtremes } from "../../charts/summaries";
import { useFormatter } from "../../format/useFormatter";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsFact, SettingsRow } from "../../settings/SettingsRow";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { bucketLabels, perBucket } from "./bucketLabels";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { axisFormats } from "./insightsFormat";
import { dayOnMap, insightsLink, placeLink } from "./insightsLinks";
import { periodPhrase } from "./insightsPeriod";
import { placeLabel, visitsText } from "./placeLabel";
import { usePlace } from "./usePlace";

/** The days listed on the place's own screen; the rest are behind "All N days". */
const latestDays = 7;

/**
 * One place (`/insights/place?place=`): the time spent there in the period,
 * how it went, when one was first and last there, and the latest days with a
 * way to each in History. A key that folded into a neighbour's place resolves
 * to that place; the address keeps the key it was given.
 */
export function PlaceScreen() {
  const { state, key, query, listed } = usePlace();
  const format = useFormatter();
  const axes = useMemo(() => axisFormats(format), [format]);
  const data = query.data;
  const place = data?.place ?? null;
  const label = place === null ? null : placeLabel(place, format);
  const title = label?.title ?? (listed === undefined ? "Place" : placeLabel(listed, format).title);
  const up = {
    to: insightsLink("/insights/places", state.params),
    label: "Places",
    always: true,
  };
  const labels = data === undefined ? null : bucketLabels(data.period.bucket, format.locale);
  const rows =
    data === undefined || labels === null
      ? []
      : data.series.map((step) => ({
          key: step.bucket,
          label: labels.label(step.bucket),
          tick: labels.tick(step.bucket),
          values: [step.durationS],
        }));
  return (
    <InsightsScreen
      state={state}
      title={title}
      documentTitle={place === null ? "Place · Places · Insights" : `${title} · Places · Insights`}
      up={up}
      pending={data?.pending ?? false}
      updating={query.isPlaceholderData}
      periodBar={key !== null}
    >
      {key === null ? (
        <div className="card">
          <EmptyState
            icon="pin"
            title="No such place"
            action={
              <LinkButton to={up.to} icon="pin">
                Back to Places
              </LinkButton>
            }
          >
            <p>The address does not name a place.</p>
          </EmptyState>
        </div>
      ) : query.isPending ? (
        <LoadingBlock label="Loading the place">
          <Skeleton height="6rem" />
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : query.isError ? (
        <ErrorState
          title="Insights could not be loaded"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.place === null || data === undefined ? (
        <div className="card">
          <EmptyState
            icon="pin"
            title={`No visits here in ${periodPhrase(state.period, format)}`}
            action={
              <LinkButton to={up.to} icon="pin">
                Back to Places
              </LinkButton>
            }
          >
            <p>Choose another period, or another device.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <InsightsHero
            label="Time here"
            value={format.duration(query.data.place.durationS)}
            detail={`${visitsText(query.data.place.visits, format.count)} on ${format.count(query.data.place.days)} ${query.data.place.days === 1 ? "day" : "days"}${label?.detail == null ? "" : ` · ${label.detail}`}`}
          />
          <BarChart
            title={`Time here ${perBucket[data.period.bucket]}`}
            summary={describeExtremes(
              rows.map((row) => ({ label: row.label, value: row.values[0] ?? 0 })),
              format.duration,
            )}
            series={[{ key: "time", label: "Time", tone: "accent" }]}
            rows={rows}
            formatValue={format.duration}
            formatTick={axes.duration}
            categoryLabel={
              data.period.bucket === "day"
                ? "Day"
                : data.period.bucket === "week"
                  ? "Week"
                  : "Month"
            }
          />
          <SettingsGroup variant="facts">
            <SettingsFact label="First here">
              {format.dateTime(query.data.place.firstAt)}
            </SettingsFact>
            <SettingsFact label="Last here">
              {format.dateTime(query.data.place.lastAt)}
            </SettingsFact>
          </SettingsGroup>
          <SettingsGroup title="Days">
            {query.data.days.slice(0, latestDays).map((day) => (
              <SettingsRow
                key={day.date}
                kind="away"
                to={dayOnMap(day.date)}
                label={format.day(day.date)}
                value={`${format.duration(day.durationS)} · ${visitsText(day.visits, format.count)}`}
              />
            ))}
            {query.data.days.length > latestDays ? (
              <SettingsRow
                kind="link"
                to={placeLink("/insights/place/days", state.params, key)}
                label={`All ${format.count(query.data.days.length)} days`}
              />
            ) : null}
          </SettingsGroup>
        </>
      )}
    </InsightsScreen>
  );
}
