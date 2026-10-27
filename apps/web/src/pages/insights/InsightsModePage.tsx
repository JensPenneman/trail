import { type TransportMode, transportModes } from "@trail/contracts/transport";
import { useId } from "react";
import { Link, useParams } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsMode } from "../../queries/useInsightsMode";
import { transportModeInfo } from "../../transport/transportModes";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { Icon } from "../../ui/Icon";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { InsightsFrame } from "./InsightsFrame";
import { insightsLink, periodPhrase } from "./insightsSearch";
import { ModeTiles } from "./ModeTiles";
import { ModeTimeCharts } from "./ModeTimeCharts";
import { ModeTrend } from "./ModeTrend";
import { ModeWays } from "./ModeWays";
import { SpeedHistogram } from "./SpeedHistogram";
import { TopMoves } from "./TopMoves";
import { useInsightsSearch } from "./useInsightsSearch";
import "./InsightsModePage.css";

const isMode = (value: string | undefined): value is TransportMode =>
  (transportModes as readonly (string | undefined)[]).includes(value);

/**
 * One mode's page (`/insights/transport/:mode`): its totals, how its distance
 * went over the period, when it is used, on which ways, the top moves (each a
 * link to its day on the map) and the moves by speed.
 */
export function InsightsModePage() {
  const { mode: param } = useParams();
  const mode = isMode(param) ? param : null;
  const state = useInsightsSearch();
  const format = useFormatter();
  const overTimeId = useId();
  const whenId = useId();
  const speedId = useId();
  const insights = useInsightsMode(mode, state.query());
  const label = mode === null ? "Unknown mode" : transportModeInfo[mode].label;
  const back = (
    <Link className="insights-back" to={insightsLink("/insights", state.params)}>
      <Icon name="chevronLeft" />
      Insights
    </Link>
  );

  if (mode === null) {
    return (
      <InsightsFrame
        state={state}
        title={label}
        documentTitle="Insights"
        description="There is no such transport mode."
        eyebrow={back}
        nav={false}
        pending={false}
        updating={false}
      >
        <div className="card">
          <EmptyState
            icon="unknown"
            title="No such mode"
            action={
              <LinkButton to={insightsLink("/insights", state.params)} icon="insights">
                Back to Insights
              </LinkButton>
            }
          >
            <p>The address names a transport mode Trail does not know.</p>
          </EmptyState>
        </div>
      </InsightsFrame>
    );
  }

  const data = insights.data;
  return (
    <InsightsFrame
      state={state}
      title={label}
      documentTitle={`${label} · Insights`}
      description={`${label} in ${periodPhrase(state.search, format)}.`}
      eyebrow={back}
      nav={false}
      pending={data?.pending ?? false}
      updating={insights.isPlaceholderData}
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
      ) : insights.data.totals.durationS <= 0 && insights.data.totals.moves === 0 ? (
        <div className="card">
          <EmptyState
            icon={transportModeInfo[mode].icon}
            title={`No ${label.toLowerCase()} in this period`}
          >
            <p>Choose a longer period, or another device.</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <ModeTiles insights={insights.data} />
          <section className="section" aria-labelledby={overTimeId}>
            <h2 className="section__title" id={overTimeId}>
              Over the period
            </h2>
            <ModeTrend insights={insights.data} />
          </section>
          <section className="section" aria-labelledby={whenId}>
            <h2 className="section__title" id={whenId}>
              When
            </h2>
            <ModeTimeCharts insights={insights.data} />
          </section>
          <ModeWays insights={insights.data} />
          <TopMoves insights={insights.data} />
          <section className="section" aria-labelledby={speedId}>
            <h2 className="section__title" id={speedId}>
              Speed
            </h2>
            <SpeedHistogram insights={insights.data} />
          </section>
        </>
      )}
    </InsightsFrame>
  );
}
