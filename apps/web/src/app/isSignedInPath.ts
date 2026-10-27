import { settingsSections } from "./settingsSections";

const sections = settingsSections.map((section) => section.id).join("|");
// `history`, `explore` and `people` only redirect to the People page, which needs a session.
const signedIn = new RegExp(
  `^/(?:history|explore|people|devices(?:/[^/]+)?|settings(?:/(?:${sections}))?)?/?$`,
);

/** Paths that only exist for signed-in people (see createAppRouter); public links (`/s#…`) are not. */
export function isSignedInPath(pathname: string): boolean {
  return signedIn.test(pathname);
}
