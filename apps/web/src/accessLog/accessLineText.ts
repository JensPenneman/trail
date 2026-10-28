import type { DataAccessActor, DataAccessEvent } from "@trail/contracts/dataAccess";
import type { Formatter } from "../format/createFormatter";
import { localDateOf } from "../time/localDateOf";
import { actionLabel, channelLabels } from "./accessActions";
import { type ResourceNames, resourceFacts } from "./resourceFacts";
import { shownName, timesText } from "./viewerSentence";

/*
 * The lines of the data access log as the pages show them: grouped by the
 * local day of their hour, the newest first within an hour, each with a
 * short summary and, opened, everything it says.
 */

/** The lines of one local day, newest hour first. */
export interface AccessDay {
  date: string;
  lines: DataAccessEvent[];
}

/**
 * The lines by the local day their hour starts in, in the list's order (the
 * newest hour first); within an hour the last access first, the server's
 * order where two end together.
 */
export function groupByDay(lines: readonly DataAccessEvent[], timeZone: string): AccessDay[] {
  const hours: DataAccessEvent[][] = [];
  for (const line of lines) {
    const last = hours.at(-1);
    if (last?.[0]?.bucketStart === line.bucketStart) last.push(line);
    else hours.push([line]);
  }
  const days: AccessDay[] = [];
  for (const hour of hours) {
    const sorted = hour
      .map((line, index) => ({ line, index }))
      .sort((a, b) => Date.parse(b.line.lastAt) - Date.parse(a.line.lastAt) || a.index - b.index)
      .map((entry) => entry.line);
    const first = sorted[0];
    if (first === undefined) continue;
    const date = localDateOf(first.bucketStart, timeZone);
    const day = days.at(-1);
    if (day?.date === date) day.lines.push(...sorted);
    else days.push({ date, lines: sorted });
  }
  return days;
}

/** Who a line's actor is, in a word or a name. */
export function actorName(actor: DataAccessActor): string {
  switch (actor.kind) {
    case "owner":
      return "You";
    case "person":
      return shownName(actor.displayName, "Someone");
    case "token":
      return shownName(actor.tokenName, "API token");
    case "link":
      return shownName(actor.linkLabel, "Public link");
  }
}

type LinkActor = Extract<DataAccessActor, { kind: "link" }>;

/** A link's visitor as the owner may know them: "iPhone · Safari, 81.82.83.0/24". */
function visitorText(actor: LinkActor): string {
  return actor.visitor === null
    ? "Other visitors, counted together"
    : `${actor.visitor.uaFamily}, ${actor.visitor.ipCoarse ?? "network unknown"}`;
}

/** What else tells the actor apart: your browser, a visitor's network and browser. */
export function actorDetail(actor: DataAccessActor): string {
  switch (actor.kind) {
    case "owner":
      return actor.sessionLabel;
    case "person":
      return "Someone you share with";
    case "token":
      return "API token";
    case "link":
      return actor.visitor === null ? visitorText(actor) : `A visitor: ${visitorText(actor)}`;
  }
}

/**
 * What a line's summary adds to its action to tell it from its neighbours:
 * your browser (in the whole log), whether a token came through the API or
 * the MCP server, which visitor of a link.
 */
export function lineAside(line: DataAccessEvent, showActor: boolean): string | null {
  switch (line.actor.kind) {
    case "owner":
      return showActor ? line.actor.sessionLabel : null;
    case "token":
      return channelLabels[line.channel];
    case "link":
      return visitorText(line.actor);
    case "person":
      return null;
  }
}

/**
 * The line counts what is not listed one by one: the accesses beyond fifty of
 * a kind in an hour, or a link's visitors beyond fifty networks.
 */
export const isFolded = (line: DataAccessEvent): boolean =>
  line.resource.folded === true || (line.actor.kind === "link" && line.actor.visitor === null);

/** "18:03", or "18:03–18:41" when the hour had more than one. */
export function whenText(line: DataAccessEvent, format: Formatter): string {
  const first = format.time(line.firstAt);
  const last = format.time(line.lastAt);
  return first === last ? last : `${first}–${last}`;
}

/** "twice", or "… and 37 more" for a line that folds what is not listed. */
export function howOftenText(line: DataAccessEvent, format: Formatter): string {
  return isFolded(line) ? `… and ${format.count(line.count)} more` : timesText(line.count, format);
}

const accessLabels = { read: "Read", write: "Change", export: "Download" } as const;

const statusTexts: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "Done",
  // A revalidation the server confirmed: the copy this browser kept was current, still a look.
  304: "Unchanged",
};

/** Everything a line says, opened: who, through what, what, when, how often, which data, the answer. */
export function lineFacts(
  line: DataAccessEvent,
  names: ResourceNames,
  format: Formatter,
): { label: string; value: string }[] {
  const status = statusTexts[line.status];
  return [
    { label: "Who", value: `${actorName(line.actor)} · ${actorDetail(line.actor)}` },
    { label: "Through", value: channelLabels[line.channel] },
    { label: "What", value: `${actionLabel(line.action, line.channel)} (${line.action})` },
    { label: "Kind", value: accessLabels[line.access] },
    {
      label: "When",
      value:
        line.firstAt === line.lastAt
          ? format.dateTime(line.lastAt)
          : `${format.dateTime(line.firstAt)} to ${format.time(line.lastAt)}`,
    },
    {
      label: "How often",
      value: isFolded(line)
        ? `${format.count(line.count)} more, counted together`
        : timesText(line.count, format),
    },
    ...resourceFacts(line.resource, names, format),
    {
      label: "Answer",
      value: status === undefined ? String(line.status) : `${line.status} ${status}`,
    },
  ];
}
