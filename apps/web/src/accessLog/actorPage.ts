import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import type { DataAccessActorRef } from "@trail/contracts/dataAccessActorId";
import type { OutgoingShare } from "@trail/contracts/share";
import type { Formatter } from "../format/createFormatter";
import { recipientName } from "../sharing/recipientName";
import type { AccessSeries } from "./AccessSeriesChart";
import type { ResourceNames } from "./resourceFacts";
import { daysPhrase } from "./viewerDays";
import {
  linkSentence,
  sessionSentence,
  shownName,
  tokenSentence,
  viewerSentence,
} from "./viewerSentence";

/** What the page of one actor shows above its lines. */
export interface ActorPage {
  title: string;
  /** What kind of actor it is. */
  kind: string;
  /** What the actor did in the period, in a sentence. */
  sentence: string;
  /** The chart's title and series. */
  chart: { title: string; series: AccessSeries[] };
  /** The actor's own page in Settings, while it exists. */
  related: { to: string; label: string; detail: string } | null;
}

const share = (shares: readonly OutgoingShare[], userId: string) =>
  shares.find((candidate) => candidate.recipient.userId === userId);

/**
 * The page of one actor — a person, a link, a token or one of your browsers
 * — from the period's summary of that actor: named as the log names them,
 * else as the lists of Settings do (nothing in the period), with what they
 * did in a sentence, a chart per day by channel and the way to their page.
 */
export function actorPage(
  ref: DataAccessActorRef,
  summary: DataAccessSummary | undefined,
  context: {
    names: ResourceNames;
    shares: readonly OutgoingShare[];
    days: number;
    format: Formatter;
    now: number;
  },
): ActorPage {
  const { names, format, now } = context;
  const nothing = `Nothing in ${daysPhrase(context.days)}.`;
  switch (ref.kind) {
    case "person": {
      const person = summary?.people.find((entry) => entry.userId === ref.userId);
      const theirs = share(context.shares, ref.userId);
      const title = shownName(
        person?.displayName ?? (theirs === undefined ? "" : recipientName(theirs)),
        "Someone you share with",
      );
      return {
        title,
        kind: "Someone you share with",
        sentence:
          person === undefined
            ? `${title} did not look at you in ${daysPhrase(context.days)}.`
            : viewerSentence(person, format, now),
        chart: {
          title: "Looks per day",
          series: [
            {
              key: "people",
              label: "Looks",
              tone: "category-1",
              value: (day) => day.byChannel.people,
            },
            {
              key: "live",
              label: "Live updates",
              tone: "muted",
              value: (day) => day.byChannel.live,
            },
          ],
        },
        related:
          theirs === undefined
            ? null
            : {
                to: `/settings/sharing/${encodeURIComponent(theirs.id)}`,
                label: `Your share with ${recipientName(theirs)}`,
                detail: "What they see of you, and stopping it",
              },
      };
    }
    case "link": {
      const link = summary?.links.find((entry) => entry.linkId === ref.linkId);
      const label = names.links?.get(ref.linkId);
      return {
        title: shownName(link?.label ?? label ?? "", "Public link"),
        kind: "A public link",
        sentence: link === undefined ? nothing : linkSentence(link, format, now),
        chart: {
          title: "Views per day",
          series: [
            { key: "link", label: "Views", tone: "accent", value: (day) => day.byChannel.link },
          ],
        },
        related:
          label === undefined
            ? null
            : {
                to: `/settings/links/${encodeURIComponent(ref.linkId)}`,
                label: "The link's page",
                detail: "What it shows, until when, and turning it off",
              },
      };
    }
    case "token": {
      const token = summary?.tokens.find((entry) => entry.tokenId === ref.tokenId);
      const name = names.tokens?.get(ref.tokenId);
      return {
        title: shownName(token?.name ?? name ?? "", "API token"),
        kind: "An API token",
        sentence: token === undefined ? nothing : tokenSentence(token, format, now),
        chart: {
          title: "Calls per day",
          series: [
            { key: "api", label: "API", tone: "category-1", value: (day) => day.byChannel.api },
            { key: "mcp", label: "MCP", tone: "category-2", value: (day) => day.byChannel.mcp },
          ],
        },
        related:
          name === undefined
            ? null
            : {
                to: `/settings/tokens/${encodeURIComponent(ref.tokenId)}`,
                label: "The token's page",
                detail: "Its permissions, rolling and revoking it",
              },
      };
    }
    case "session": {
      const session = summary?.own.sessions.find((entry) => entry.label === ref.label);
      return {
        title: ref.label,
        kind: "Your own browser",
        sentence:
          session === undefined
            ? nothing
            : `You: ${sessionSentence(session, format, now).replace(/^./, (first) => first.toLowerCase())}`,
        chart: {
          title: "Accesses per day",
          series: [
            { key: "web", label: "Accesses", tone: "accent", value: (day) => day.byChannel.web },
          ],
        },
        related: {
          to: "/settings/browsers",
          label: "Browsers",
          detail: "The browsers signed in to your account",
        },
      };
    }
  }
}
