/**
 * An address's parameters as a list sorted by name: what a test compares when more than one
 * effect writes the address (a view switch, the person a link implies), so that neither the
 * order they land in nor the moment of the last one matters — only which parameters there are.
 */
export const paramsOf = (search: string): [string, string][] =>
  [...new URLSearchParams(search)].sort(([a], [b]) => a.localeCompare(b));
