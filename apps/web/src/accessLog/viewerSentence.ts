import type { DataAccessSummary } from "@trail/contracts/dataAccess";
import type { Formatter } from "../format/createFormatter";
import { type LookKind, lookKindOf } from "./accessActions";

type PersonSummary = DataAccessSummary["people"][number];
type LinkSummary = DataAccessSummary["links"][number];
type TokenSummary = DataAccessSummary["tokens"][number];

/** "once", "twice", "14 times". */
export function timesText(count: number, format: Formatter): string {
  if (count === 1) return "once";
  if (count === 2) return "twice";
  return `${format.count(count)} times`;
}

/** `count` and the noun for one or for more: "1 visitor", "2 visitors". */
export function counted(count: number, one: string, more: string, format: Formatter): string {
  return `${format.count(count)} ${count === 1 ? one : more}`;
}

/** "last today at 18:03", "last on Tuesday at 18:03". */
export function lastText(instant: string, format: Formatter, now: number): string {
  return `last ${format.onDay(instant, now)} at ${format.time(instant)}`;
}

/** How often a person looked at what, from the summary's `actions`. */
function looksOf(actions: PersonSummary["actions"]): Record<LookKind, number> {
  const looks: Record<LookKind, number> = { position: 0, history: 0, live: 0, other: 0 };
  for (const { action, count } of actions) looks[lookKindOf(action)] += count;
  return looks;
}

/** A name as the pages show it: one that holds nothing visible reads as `fallback`. */
export const shownName = (name: string, fallback: string): string =>
  name.trim() === "" ? fallback : name;

/** What one person did, without their name: "looked at your live position 14 times, last today at 18:03." */
function viewerClause(person: PersonSummary, format: Formatter, now: number): string {
  const looks = looksOf(person.actions);
  const seen = [
    looks.position > 0 ? `your live position ${timesText(looks.position, format)}` : null,
    looks.history > 0 ? `your history ${timesText(looks.history, format)}` : null,
    looks.other > 0 ? `other data ${timesText(looks.other, format)}` : null,
  ].filter((part) => part !== null);
  const live = looks.live > 0 ? counted(looks.live, "live update", "live updates", format) : null;
  const clause =
    seen.length > 0
      ? `looked at ${format.list(seen)}${live === null ? "" : `, and received ${live}`}`
      : live !== null
        ? `received ${live} of your position`
        : `looked at you ${timesText(person.events, format)}`;
  return `${clause}, ${lastText(person.lastAt, format, now)}.`;
}

/**
 * What one person did with your data, in a sentence: "Ana looked at your
 * live position 14 times and your history twice, last on Tuesday at 18:03."
 * Live updates their open page received count apart from their looks.
 */
export function viewerSentence(person: PersonSummary, format: Formatter, now: number): string {
  return `${shownName(person.displayName, "Someone")} ${viewerClause(person, format, now)}`;
}

/** The same sentence for a row that already shows the name: "Looked at your live position …". */
export function viewerDetail(person: PersonSummary, format: Formatter, now: number): string {
  const clause = viewerClause(person, format, now);
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
}

/** "Opened 2 times by 1 visitor, last today at 09:12." */
export function linkSentence(link: LinkSummary, format: Formatter, now: number): string {
  const visitors =
    link.visitors === 0 ? "" : ` by ${counted(link.visitors, "visitor", "visitors", format)}`;
  return `Opened ${timesText(link.events, format)}${visitors}, ${lastText(link.lastAt, format, now)}.`;
}

/** "Used 14 times: 10 API calls and 4 through MCP, last today at 08:00." */
export function tokenSentence(token: TokenSummary, format: Formatter, now: number): string {
  const parts = [
    token.api > 0 ? counted(token.api, "API call", "API calls", format) : null,
    token.mcp > 0 ? `${format.count(token.mcp)} through MCP` : null,
  ].filter((part) => part !== null);
  const split = parts.length > 1 ? `: ${format.list(parts)}` : "";
  return `Used ${timesText(token.events, format)}${split}, ${lastText(token.lastAt, format, now)}.`;
}

/** "You, 120 times, last today at 11:40." for one of your own browsers. */
export function sessionSentence(
  session: DataAccessSummary["own"]["sessions"][number],
  format: Formatter,
  now: number,
): string {
  return `${timesText(session.events, format).replace(/^./, (first) => first.toUpperCase())}, ${lastText(session.lastAt, format, now)}.`;
}
