import type { ReactNode } from "react";
import { DocumentTitle } from "../../app/DocumentTitle";
import { Notice } from "../../ui/Notice";
import { PageHeader } from "../../ui/PageHeader";
import { InsightsFilters } from "./InsightsFilters";
import { InsightsNav } from "./InsightsNav";
import type { InsightsSearchState } from "./useInsightsSearch";
import "./InsightsFrame.css";

interface InsightsFrameProps {
  state: InsightsSearchState;
  title: string;
  /** The tab's title, before "· Trail". */
  documentTitle: string;
  description: ReactNode;
  eyebrow?: ReactNode;
  /** The Overview, When you travel and Roads pages share a navigation; a mode page has a way back. */
  nav?: boolean;
  /** The page's own filter, in the row of filters. */
  filter?: ReactNode;
  /** Processing has work in the period: the numbers may still change. */
  pending: boolean;
  /** The previous answer is shown while the next one loads. */
  updating: boolean;
  children: ReactNode;
}

/** What every Insights page has: its heading, the navigation, the filters, a word on processing. */
export function InsightsFrame({
  state,
  title,
  documentTitle,
  description,
  eyebrow,
  nav = true,
  filter,
  pending,
  updating,
  children,
}: InsightsFrameProps) {
  return (
    <div className="page insights-page">
      <DocumentTitle title={documentTitle} />
      <PageHeader
        title={title}
        description={description}
        {...(eyebrow === undefined ? {} : { eyebrow })}
      />
      {nav ? <InsightsNav params={state.params} /> : null}
      <InsightsFilters state={state} {...(filter === undefined ? {} : { extra: filter })} />
      {pending ? (
        <Notice tone="info" title="Processing is still catching up">
          <p>
            Some points of this period are still being worked out, so these numbers may change in a
            moment.
          </p>
        </Notice>
      ) : null}
      <div className="insights-page__content" aria-busy={updating}>
        {children}
      </div>
    </div>
  );
}
