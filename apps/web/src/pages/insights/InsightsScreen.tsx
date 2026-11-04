import { type ReactNode, useEffect, useRef } from "react";
import { ShellPage, type ShellUp } from "../../settings/ShellPage";
import { Notice } from "../../ui/Notice";
import { useAnnounce } from "../../ui/useAnnounce";
import { InsightsPeriodBar } from "./InsightsPeriodBar";
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
  /** Said politely when it changes (the new period's figure); not when the screen opens. */
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
  const spoken = useRef<string | null>(announcement);
  useEffect(() => {
    if (announcement === null || announcement === spoken.current) return;
    spoken.current = announcement;
    announce(announcement);
  }, [announcement, announce]);
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
