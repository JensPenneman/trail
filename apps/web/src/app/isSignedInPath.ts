/** Paths that only exist for signed-in people (see createAppRouter); public links (`/s/…`) are not. */
export function isSignedInPath(pathname: string): boolean {
  return /^\/(?:history|explore|people|devices(?:\/[^/]+)?|settings)?\/?$/.test(pathname);
}
