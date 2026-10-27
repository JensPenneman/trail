import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import { dataAccessActorId } from "@trail/contracts/dataAccessActorId";
import { useId } from "react";
import { AccessSeriesChart } from "../../accessLog/AccessSeriesChart";
import { viewerPath } from "../../accessLog/actorAddress";
import { OwnActivitySwitch } from "../../accessLog/OwnActivitySwitch";
import { PeriodChoice } from "../../accessLog/PeriodChoice";
import { actorSeries, othersLooked } from "../../accessLog/summaryFacts";
import { useOwnActivity } from "../../accessLog/useOwnActivity";
import { daysPhrase, useViewerDays, type ViewerDays } from "../../accessLog/viewerDays";
import {
  counted,
  linkSentence,
  sessionSentence,
  shownName,
  tokenSentence,
  viewerSentence,
} from "../../accessLog/viewerSentence";
import { StatTile } from "../../charts/StatTile";
import { StatTiles } from "../../charts/StatTiles";
import type { Formatter } from "../../format/createFormatter";
import { useFormatter } from "../../format/useFormatter";
import { useAccessSummary } from "../../queries/useAccessSummary";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { useNow } from "../../time/useNow";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import "./ViewersPage.css";

/** The headline numbers: people, link visitors, API and MCP calls, and your own when shown. */
function ViewerTiles({
  summary,
  showOwn,
  format,
}: {
  summary: DataAccessSummary;
  showOwn: boolean;
  format: Formatter;
}) {
  const { totals, tokens, own } = summary;
  const { byChannel } = totals;
  const by = (count: number) =>
    count === 0 ? undefined : `by ${counted(count, "token", "tokens", format)}`;
  return (
    <StatTiles label={`Totals of ${daysPhrase(summary.days)}`}>
      <StatTile
        label="People"
        icon="users"
        value={format.count(totals.people)}
        detail={[
          counted(byChannel.people, "look", "looks", format),
          ...(byChannel.live > 0
            ? [counted(byChannel.live, "live update", "live updates", format)]
            : []),
        ].join(" · ")}
      />
      <StatTile
        label="Link visitors"
        icon="link"
        value={format.count(totals.visitors)}
        detail={counted(byChannel.link, "view", "views", format)}
      />
      <StatTile
        label="API calls"
        icon="code"
        value={format.count(byChannel.api)}
        detail={by(tokens.filter((token) => token.api > 0).length)}
      />
      <StatTile
        label="MCP calls"
        icon="plug"
        value={format.count(byChannel.mcp)}
        detail={by(tokens.filter((token) => token.mcp > 0).length)}
      />
      {showOwn ? (
        <StatTile
          label="Your own activity"
          icon="user"
          value={format.count(own.events)}
          detail={`in ${counted(own.sessions.length, "browser", "browsers", format)}`}
        />
      ) : null}
    </StatTiles>
  );
}

/** Who looked, a row each with what they did, leading to their own page. */
function ViewerLists({
  summary,
  showOwn,
  days,
  format,
  now,
}: {
  summary: DataAccessSummary;
  showOwn: boolean;
  days: ViewerDays;
  format: Formatter;
  now: number;
}) {
  const query = days === 30 ? "" : `?days=${days}`;
  const to = (actorId: string) => `${viewerPath(actorId)}${query}`;
  return (
    <>
      {summary.people.length === 0 ? null : (
        <SettingsGroup
          title="People"
          footer="Their looks at your position and your history, and the new positions their open page received."
        >
          {summary.people.map((person) => (
            <SettingsRow
              key={person.userId}
              kind="link"
              to={to(dataAccessActorId({ kind: "person", userId: person.userId }))}
              icon="user"
              tone="green"
              label={shownName(person.displayName, "Someone")}
              detail={viewerSentence(person, format, now)}
            />
          ))}
        </SettingsGroup>
      )}
      {summary.links.length === 0 ? null : (
        <SettingsGroup
          title="Public links"
          footer="A visitor is one network and one kind of browser: never an address."
        >
          {summary.links.map((link) => (
            <SettingsRow
              key={link.linkId}
              kind="link"
              to={to(dataAccessActorId({ kind: "link", linkId: link.linkId }))}
              icon="link"
              tone="teal"
              label={shownName(link.label, "Public link")}
              detail={linkSentence(link, format, now)}
            />
          ))}
        </SettingsGroup>
      )}
      {summary.tokens.length === 0 ? null : (
        <SettingsGroup
          title="API tokens"
          footer="Directly through the API, or through the MCP server."
        >
          {summary.tokens.map((token) => (
            <SettingsRow
              key={token.tokenId}
              kind="link"
              to={to(dataAccessActorId({ kind: "token", tokenId: token.tokenId }))}
              icon="code"
              tone="gray"
              label={shownName(token.name, "API token")}
              detail={tokenSentence(token, format, now)}
            />
          ))}
        </SettingsGroup>
      )}
      {showOwn && summary.own.sessions.length > 0 ? (
        <SettingsGroup title="Your browsers">
          {summary.own.sessions.map((session) => (
            <SettingsRow
              key={session.label}
              kind="link"
              to={to(dataAccessActorId({ kind: "session", label: session.label }))}
              icon="monitor"
              tone="blue"
              label={shownName(session.label, "A browser")}
              detail={sessionSentence(session, format, now)}
            />
          ))}
        </SettingsGroup>
      ) : null}
    </>
  );
}

/**
 * Settings › Who viewed you: over the last 7, 30 or 90 days, who looked at
 * your data — the people you share with, the visitors of your public links,
 * your API tokens and agents, and yourself if you choose — how often, per
 * day, and a page for each of them with what they read.
 */
export function ViewersPage() {
  const format = useFormatter();
  const now = useNow(60_000);
  const totalsId = useId();
  const [days, setDays] = useViewerDays();
  const own = useOwnActivity();
  const summary = useAccessSummary({ days, actorId: null });
  const data = summary.data;
  const series = actorSeries(own.showOwn);
  const anything =
    data !== undefined && (othersLooked(data) || (own.showOwn && data.own.events > 0));

  return (
    <SettingsPage page="viewers">
      <div className="viewers__controls">
        <PeriodChoice days={days} onChange={setDays} />
      </div>
      <OwnActivitySwitch own={own} />
      {summary.isPending ? (
        <LoadingBlock label="Loading who viewed you">
          <Skeleton height="6rem" />
          <Skeleton height="16rem" />
        </LoadingBlock>
      ) : summary.isError && data === undefined ? (
        <ErrorState
          title="Who viewed you could not be loaded"
          error={summary.error}
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      ) : data === undefined ? null : (
        <div className="viewers__content" aria-busy={summary.isPlaceholderData}>
          {anything ? (
            <>
              <section aria-labelledby={totalsId} className="viewers__totals">
                <h2 className="visually-hidden" id={totalsId}>
                  Totals
                </h2>
                <ViewerTiles summary={data} showOwn={own.showOwn} format={format} />
              </section>
              <SettingsGroup variant="card">
                <AccessSeriesChart
                  title="Accesses per day, by who"
                  summary={data}
                  series={series}
                />
              </SettingsGroup>
              <ViewerLists
                summary={data}
                showOwn={own.showOwn}
                days={days}
                format={format}
                now={now}
              />
            </>
          ) : (
            <SettingsGroup variant="card">
              <EmptyState icon="eye" title={`Nobody looked in ${daysPhrase(days)}`}>
                <p>
                  When someone you share with looks at you, a visitor opens one of your public links
                  or one of your API tokens reads your data, it shows here
                  {own.showOwn ? ", and so does what you do yourself" : ""}.
                </p>
              </EmptyState>
            </SettingsGroup>
          )}
        </div>
      )}
      <SettingsGroup title="Related">
        <SettingsRow
          kind="link"
          to="/settings/privacy/access-log"
          icon="history"
          tone="gray"
          label="Access log"
          detail="Every access, line by line"
        />
        <SettingsRow
          kind="link"
          to="/settings/sharing"
          icon="users"
          tone="green"
          label="Sharing"
          detail="Who may see you, and what"
        />
        <SettingsRow
          kind="link"
          to="/settings/links"
          icon="link"
          tone="teal"
          label="Public links"
        />
        <SettingsRow kind="link" to="/settings/tokens" icon="code" tone="gray" label="API tokens" />
      </SettingsGroup>
    </SettingsPage>
  );
}
