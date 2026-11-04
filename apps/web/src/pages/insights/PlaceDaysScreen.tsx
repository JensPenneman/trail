import { useFormatter } from "../../format/useFormatter";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsHero } from "./InsightsHero";
import { InsightsScreen } from "./InsightsScreen";
import { dayOnMap, insightsLink, placeLink } from "./insightsLinks";
import { periodPhrase } from "./insightsPeriod";
import { placeLabel } from "./placeLabel";
import { usePlace } from "./usePlace";
import "./PlaceDaysScreen.css";

/**
 * All the days at a place (`/insights/place/days?place=`), newest first: a
 * list of up to three years of days, so the rows are laid out only as they
 * come into view.
 */
export function PlaceDaysScreen() {
  const { state, key, query } = usePlace();
  const format = useFormatter();
  const data = query.data;
  const place = data?.place ?? null;
  const name = place === null ? "Place" : placeLabel(place, format).title;
  const places = insightsLink("/insights/places", state.params);
  const up = {
    to: key === null ? places : placeLink("/insights/place", state.params, key),
    label: name,
    always: true,
  };
  return (
    <InsightsScreen
      state={state}
      title="Days"
      documentTitle={`Days · ${name} · Places · Insights`}
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
              <LinkButton to={places} icon="pin">
                Back to Places
              </LinkButton>
            }
          >
            <p>The address does not name a place.</p>
          </EmptyState>
        </div>
      ) : query.isPending ? (
        <LoadingBlock label="Loading the days">
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
      ) : query.data.place === null ? (
        <div className="card">
          <EmptyState
            icon="pin"
            title={`No visits here in ${periodPhrase(state.period, format)}`}
            action={
              <LinkButton to={places} icon="pin">
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
            label="Days here"
            value={`${format.count(query.data.days.length)} ${query.data.days.length === 1 ? "day" : "days"}`}
          />
          <div className="place-days">
            <SettingsGroup>
              {query.data.days.map((day) => (
                <SettingsRow
                  key={day.date}
                  kind="away"
                  to={dayOnMap(day.date)}
                  label={format.day(day.date)}
                  value={`${format.duration(day.durationS)} · ${day.visits} ${day.visits === 1 ? "visit" : "visits"}`}
                />
              ))}
            </SettingsGroup>
          </div>
        </>
      )}
    </InsightsScreen>
  );
}
