import type { DataAccessEvent } from "@trail/contracts/dataAccess";
import { actorIdOf } from "@trail/contracts/dataAccessActorId";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Link } from "react-router";
import type { AccessLogParams } from "../api/queryKeys";
import type { Formatter } from "../format/createFormatter";
import { useFormatter } from "../format/useFormatter";
import { useAccessLog } from "../queries/useAccessLog";
import { addDays } from "../time/addDays";
import { useToday } from "../time/useToday";
import { Button } from "../ui/Button";
import { ErrorState } from "../ui/ErrorState";
import { Icon } from "../ui/Icon";
import { LoadingBlock } from "../ui/LoadingBlock";
import { PlainList } from "../ui/PlainList";
import { Skeleton } from "../ui/Skeleton";
import { useAnnounce } from "../ui/useAnnounce";
import { actionLabel } from "./accessActions";
import {
  actorName,
  groupByDay,
  howOftenText,
  lineAside,
  lineFacts,
  whenText,
} from "./accessLineText";
import { viewerPath } from "./actorAddress";
import type { ResourceNames } from "./resourceFacts";
import "./AccessLines.css";

interface AccessLinesProps {
  params: AccessLogParams;
  /** Each line names its actor (the whole log); one actor's page leaves that out. */
  showActor: boolean;
  names: ResourceNames;
  /** The headings of the days: under the page's title, or under a heading of its own. */
  headingLevel: 2 | 3;
  /** What shows when no line matches. */
  empty: ReactNode;
}

/** "Today", "Yesterday", "Monday, 26 October 2026". */
function dayTitle(date: string, today: string, format: Formatter): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return format.dayLong(date);
}

function AccessLine({
  line,
  showActor,
  names,
  format,
}: {
  line: DataAccessEvent;
  showActor: boolean;
  names: ResourceNames;
  format: Formatter;
}) {
  const what = actionLabel(line.action, line.channel);
  const title = showActor ? actorName(line.actor) : what;
  const meta = [
    showActor ? what : null,
    lineAside(line, showActor),
    howOftenText(line, format),
    whenText(line, format),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <li className="access-line">
      <details className="access-line__details">
        <summary className="access-line__summary">
          <span className="access-line__text">
            <span className="access-line__title">{title}</span>
            <span className="access-line__meta">{meta}</span>
          </span>
          <Icon name="chevronDown" className="access-line__chevron" />
        </summary>
        <dl className="access-line__facts">
          {lineFacts(line, names, format).map((fact) => (
            <div key={fact.label} className="access-line__fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
        {/* In the whole log, the way to everything this actor did (your own browser has its own
            page under Who viewed you). */}
        {showActor && line.actor.kind !== "owner" ? (
          <p className="access-line__more">
            <Link to={viewerPath(actorIdOf(line.actor))}>
              Everything by {actorName(line.actor)}
            </Link>
          </p>
        ) : null}
      </details>
    </li>
  );
}

/**
 * Lines of the data access log, a card per local day, newest first; each
 * line opens to everything it says. More come with "Load more", and by
 * themselves as that comes into view — the button stays for keyboards and
 * screen readers, and for when loading failed.
 */
export function AccessLines({ params, showActor, names, headingLevel, empty }: AccessLinesProps) {
  const format = useFormatter();
  const today = useToday();
  const log = useAccessLog(params);
  const idPrefix = useId();
  const announce = useAnnounce();
  const more = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLParagraphElement>(null);
  // How many lines there were when the button asked for more: what to announce once they came.
  const asked = useRef<number | null>(null);
  const lines = log.data?.pages.flatMap((page) => page.items) ?? [];
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = log;
  const loaded = lines.length;

  // After the button's page: say what came, and where the button went once there is no more,
  // move its focus to the line that says so rather than losing it to the page.
  useEffect(() => {
    const before = asked.current;
    if (before === null || isFetchingNextPage) return;
    asked.current = null;
    if (isFetchNextPageError) return;
    const added = loaded - before;
    announce(
      `${added} more ${added === 1 ? "line" : "lines"}${hasNextPage ? "" : ". That is all"}.`,
    );
    if (!hasNextPage && document.activeElement === document.body) end.current?.focus();
  }, [announce, hasNextPage, isFetchingNextPage, isFetchNextPageError, loaded]);

  // Next pages by themselves while the end of the list is (nearly) in view: observed anew after
  // every page, so a short page that leaves the end in view brings the next one too.
  useEffect(() => {
    const target = more.current;
    if (target === null || typeof IntersectionObserver === "undefined") return;
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError || loaded === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Not again while a page is on its way: the button may ask for the same one.
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage({ cancelRefetch: false });
        }
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, loaded]);

  if (log.isPending) {
    return (
      <LoadingBlock label="Loading the access log">
        <Skeleton height="12rem" />
      </LoadingBlock>
    );
  }
  if (log.isError && log.data === undefined) {
    return (
      <ErrorState
        title="The access log could not be loaded"
        error={log.error}
        onRetry={() => void log.refetch()}
        retrying={log.isFetching}
      />
    );
  }
  if (lines.length === 0) return <>{empty}</>;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="access-lines" aria-busy={log.isFetching}>
      {groupByDay(lines, format.timeZone).map((day) => {
        const headingId = `${idPrefix}-${day.date}`;
        return (
          <section key={day.date} className="settings-group" aria-labelledby={headingId}>
            <Heading className="settings-group__title" id={headingId}>
              {dayTitle(day.date, today, format)}
            </Heading>
            <PlainList className="settings-group__body" labelledBy={headingId}>
              {day.lines.map((line) => (
                <AccessLine
                  key={line.id}
                  line={line}
                  showActor={showActor}
                  names={names}
                  format={format}
                />
              ))}
            </PlainList>
          </section>
        );
      })}
      {isFetchNextPageError ? (
        <ErrorState title="Older lines could not be loaded" error={log.error} />
      ) : null}
      <div ref={more} className="access-lines__more">
        {hasNextPage ? (
          // Never disabled while it loads: a disabled button would drop the keyboard's focus.
          <Button
            aria-disabled={isFetchingNextPage}
            onClick={() => {
              if (isFetchingNextPage) return;
              asked.current = loaded;
              void fetchNextPage({ cancelRefetch: false });
            }}
          >
            {isFetchingNextPage ? "Loading…" : isFetchNextPageError ? "Try again" : "Load more"}
          </Button>
        ) : (
          <p className="access-lines__end" ref={end} tabIndex={-1}>
            {params.from === null
              ? "That is all: lines are kept for a year."
              : "That is all for this period."}
          </p>
        )}
      </div>
    </div>
  );
}
