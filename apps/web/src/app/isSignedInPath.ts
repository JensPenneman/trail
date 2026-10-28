import { settingsPathsSource } from "../settings/settingsTree";

// `history`, `explore` and `people` only redirect to the People page, and `devices` to
// Settings › Devices: pages that need a session.
const signedIn = new RegExp(
  `^(?:/(?:history|explore|people|devices(?:/[^/]+)?|insights(?:/(?:time|roads|transport/[^/]+))?)?|${settingsPathsSource()})/?$`,
);

/** Paths that only exist for signed-in people (see createAppRouter); public links (`/s#…`) are not. */
export function isSignedInPath(pathname: string): boolean {
  return signedIn.test(pathname);
}
