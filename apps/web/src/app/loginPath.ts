/** `/login`, remembering where to return to after signing in (unless that is the start page). */
export function loginPath(location: { pathname: string; search: string; hash: string }): string {
  const next = `${location.pathname}${location.search}${location.hash}`;
  return next === "/" || next.startsWith("/login")
    ? "/login"
    : `/login?next=${encodeURIComponent(next)}`;
}
