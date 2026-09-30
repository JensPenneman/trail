/**
 * The `next` parameter after sign-in, accepted only as an in-app path: an
 * absolute or protocol-relative URL would turn the login page into an open
 * redirect.
 */
export function safeNextPath(next: string | null): string {
  if (next === null || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}
