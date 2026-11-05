import { type ReactNode, useEffect, useRef } from "react";
import { useFormatter } from "../../format/useFormatter";
import { ShellPage, type ShellUp } from "../../settings/ShellPage";
import { Notice } from "../../ui/Notice";
import { useAnnounce } from "../../ui/useAnnounce";
import { InsightsPeriodBar } from "./InsightsPeriodBar";
import { periodLabel } from "./insightsPeriod";
import type { InsightsPeriodState } from "./useInsightsPeriod";
import "./InsightsScreen.css";

interface InsightsScreenProps {
  state: InsightsPeriodState;
  title: string;
  /** The tab's title, before "· Trail". */
  documentTitle: string;
  /** The way up; null on the summary. */
  up: ShellUp | null;
  /** Processing has work in the period: the numbers may still change. */
  pending: boolean;
  /** The previous answer is shown while the next one loads. */
  updating: boolean;
  /**
   * Said politely once the answer for a period the person chose is there (the new period's
   * figure); not when the screen opens, nor when the same period is refetched.
   */
  announcement?: string | null;
  /** Whether the period can be chosen on this screen (not on one that names nothing). */
  periodBar?: boolean;
  children: ReactNode;
}

/** What every Insights screen has: its title and way up, the period bar, a word on processing. */
export function InsightsScreen({
  state,
  title,
  documentTitle,
  up,
  pending,
  updating,
  announcement = null,
  periodBar = true,
  children,
}: InsightsScreenProps) {
  const announce = useAnnounce();
  const format = useFormatter();
  // The period and devices that were last announced, or shown when the screen opened.
  const period = `${periodLabel(state.period, format)}|${state.devices?.join(",") ?? ""}`;
  const spoken = useRef(period);
  useEffect(() => {
    if (announcement === null || period === spoken.current) return;
    spoken.current = period;
    announce(announcement);
  }, [announcement, period, announce]);
  return (
    <ShellPage
      title={title}
      documentTitle={documentTitle}
      up={up}
      controls={periodBar ? <InsightsPeriodBar state={state} /> : undefined}
    >
      {pending ? (
        <Notice tone="info" title="Processing is still catching up">
          <p>
            Some points of this period are still being worked out, so these numbers may change in a
            moment.
          </p>
        </Notice>
      ) : null}
      <div className="insights-screen__content" aria-busy={updating}>
        {children}
      </div>
    </ShellPage>
  );
}
