const localDate = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86_400_000;

/**
 * How many days a request's `from` and `to` span, the one thing of a query
 * the request log keeps: local dates count both ends (`to` is the last day,
 * included), instants count the hours between them as whole days, at least
 * one. Null unless the URL has both and both read as one or the other.
 */
export function daySpan(url: string): number | null {
  const start = url.indexOf("?");
  if (start === -1) return null;
  const query = new URLSearchParams(url.slice(start + 1));
  const from = query.get("from");
  const to = query.get("to");
  if (from === null || to === null) return null;
  const dates = localDate.test(from) && localDate.test(to);
  if (localDate.test(from) !== localDate.test(to)) return null;
  const span =
    Date.parse(dates ? `${to}T00:00:00Z` : to) - Date.parse(dates ? `${from}T00:00:00Z` : from);
  if (!Number.isFinite(span) || span < 0) return null;
  return dates ? Math.round(span / dayMs) + 1 : Math.max(1, Math.round(span / dayMs));
}
