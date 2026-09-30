/** Paths that only exist for signed-in people (see createAppRouter). */
export function isSignedInPath(pathname: string): boolean {
  return /^\/(?:history|explore|devices(?:\/[^/]+)?|settings)?\/?$/.test(pathname);
}
