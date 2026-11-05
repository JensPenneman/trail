import { type TransportMode, transportModes } from "@trail/contracts/transport";
import type { ReactNode } from "react";
import { useParams } from "react-router";
import type { ShellUp } from "../../settings/ShellPage";
import { transportModeInfo } from "../../transport/transportModes";
import { EmptyState } from "../../ui/EmptyState";
import { LinkButton } from "../../ui/LinkButton";
import { InsightsScreen } from "./InsightsScreen";
import { insightsRootPath, modePath } from "./insightsLevels";
import { insightsLink } from "./insightsLinks";
import { type InsightsPeriodState, useInsightsPeriod } from "./useInsightsPeriod";

export const isMode = (value: string | undefined): value is TransportMode =>
  (transportModes as readonly (string | undefined)[]).includes(value);

/** What a screen of a mode needs: the mode, its name, the period and the way up. */
export interface ModeContext {
  mode: TransportMode;
  label: string;
  state: InsightsPeriodState;
  /** The summary for the mode's own screen, the mode's screen for its parts. */
  up: ShellUp;
}

/**
 * Screens of one mode (`/insights/transport/:mode` and its parts) have the
 * mode in the address: an unknown one is a screen saying so, asking for
 * nothing; otherwise `render` gets the mode with the period and the way up.
 */
export function WithMode({
  part,
  render,
}: {
  /** A screen of a part of the mode goes up to the mode's own screen; the mode's screen to the summary. */
  part: boolean;
  render: (context: ModeContext) => ReactNode;
}) {
  const { mode: param } = useParams();
  const state = useInsightsPeriod();
  if (!isMode(param)) {
    const to = insightsLink(insightsRootPath, state.params);
    return (
      <InsightsScreen
        state={state}
        title="Unknown mode"
        documentTitle="Insights"
        up={{ to, label: "Insights", always: false }}
        pending={false}
        updating={false}
        periodBar={false}
      >
        <div className="card">
          <EmptyState
            icon="unknown"
            title="No such mode"
            action={
              <LinkButton to={to} icon="insights">
                Back to Insights
              </LinkButton>
            }
          >
            <p>The address names a transport mode Trail does not know.</p>
          </EmptyState>
        </div>
      </InsightsScreen>
    );
  }
  const label = transportModeInfo[param].label;
  const up: ShellUp = part
    ? { to: insightsLink(modePath(param), state.params), label, always: true }
    : { to: insightsLink(insightsRootPath, state.params), label: "Insights", always: false };
  return render({ mode: param, label, state, up });
}
