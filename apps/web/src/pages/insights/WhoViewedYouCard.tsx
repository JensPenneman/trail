import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import { useId } from "react";
import { othersLooked } from "../../accessLog/summaryFacts";
import { daysPhrase, usageDays } from "../../accessLog/viewerDays";
import { counted, shownName, timesText } from "../../accessLog/viewerSentence";
import { StatTile } from "../../charts/StatTile";
import { StatTiles } from "../../charts/StatTiles";
import type { Formatter } from "../../format/createFormatter";
import { useFormatter } from "../../format/useFormatter";
import { useAccessSummary } from "../../queries/useAccessSummary";
import { LinkButton } from "../../ui/LinkButton";

/** Who looked most often: a person, a link or a token, whichever counted most. */
export function topViewerText(summary: DataAccessSummary, format: Formatter): string | null {
  const candidates = [
    ...summary.people.slice(0, 1).map((person) => ({
      events: person.events,
      text: `${shownName(person.displayName, "Someone")} looked most often: ${timesText(person.events, format)}.`,
    })),
    ...summary.links.slice(0, 1).map((link) => ({
      events: link.events,
      text: `Your link “${shownName(link.label, "Public link")}” was opened most often: ${timesText(link.events, format)}.`,
    })),
    ...summary.tokens.slice(0, 1).map((token) => ({
      events: token.events,
      text: `Your token “${shownName(token.name, "API token")}” was used most often: ${timesText(token.events, format)}.`,
    })),
  ];
  let top: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (top === undefined || candidate.events > top.events) top = candidate;
  }
  return top?.text ?? null;
}

/**
 * Insights' card of who viewed you in the last 30 days — people, link
 * visitors, token calls and who did most — leading to Settings › Who viewed
 * you. Shown only once someone but you has looked.
 */
export function WhoViewedYouCard() {
  const format = useFormatter();
  const titleId = useId();
  const summary = useAccessSummary({ days: usageDays, actorId: null });
  const data = summary.data;
  if (data === undefined || !othersLooked(data)) return null;
  const { totals } = data;
  const top = topViewerText(data, format);
  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="section__header">
        <h2 className="section__title" id={titleId}>
          Who viewed you
        </h2>
        <p className="section__description">In {daysPhrase(usageDays)}</p>
      </div>
      <div className="stack">
        <StatTiles label={`Who viewed you in ${daysPhrase(usageDays)}`}>
          <StatTile
            label="People"
            icon="users"
            value={format.count(totals.people)}
            detail={counted(totals.byChannel.people, "look", "looks", format)}
          />
          <StatTile
            label="Link visitors"
            icon="link"
            value={format.count(totals.visitors)}
            detail={counted(totals.byChannel.link, "view", "views", format)}
          />
          <StatTile
            label="Token calls"
            icon="code"
            value={format.count(totals.byActorKind.token)}
            detail={
              totals.byChannel.mcp === 0
                ? undefined
                : `${format.count(totals.byChannel.mcp)} through MCP`
            }
          />
        </StatTiles>
        {top === null ? null : <p>{top}</p>}
        <div>
          <LinkButton to="/settings/privacy/viewers" icon="eye">
            See who viewed you
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
