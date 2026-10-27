import { Navigate, type RouteObject, useLocation } from "react-router";
import {
  type SettingsDetailId,
  type SettingsPageId,
  settingsPageNodes,
  settingsRedirects,
  settingsRootPath,
} from "./settingsTree";

type LazyPage = NonNullable<RouteObject["lazy"]>;

/** The module of every page of the tree: each its own chunk, loaded on the first visit. */
const pageModules: Readonly<Record<SettingsPageId, LazyPage>> = {
  profile: () =>
    import("../pages/settings/ProfilePage").then((m) => ({ Component: m.ProfilePage })),
  passkeys: () =>
    import("../pages/settings/PasskeysPage").then((m) => ({ Component: m.PasskeysPage })),
  browsers: () =>
    import("../pages/settings/BrowsersPage").then((m) => ({ Component: m.BrowsersPage })),
  sharing: () =>
    import("../pages/settings/SharingPage").then((m) => ({ Component: m.SharingPage })),
  links: () =>
    import("../pages/settings/PublicLinksPage").then((m) => ({ Component: m.PublicLinksPage })),
  viewers: () =>
    import("../pages/settings/ViewersPage").then((m) => ({ Component: m.ViewersPage })),
  "access-log": () =>
    import("../pages/settings/AccessLogPage").then((m) => ({ Component: m.AccessLogPage })),
  data: () => import("../pages/settings/DataPage").then((m) => ({ Component: m.DataPage })),
  tokens: () =>
    import("../pages/settings/ApiTokensPage").then((m) => ({ Component: m.ApiTokensPage })),
  mcp: () => import("../pages/settings/McpPage").then((m) => ({ Component: m.McpPage })),
  preferences: () =>
    import("../pages/settings/PreferencesPage").then((m) => ({ Component: m.PreferencesPage })),
  notifications: () =>
    import("../pages/settings/NotificationsPage").then((m) => ({
      Component: m.NotificationsPage,
    })),
  about: () => import("../pages/settings/AboutPage").then((m) => ({ Component: m.AboutPage })),
  accounts: () =>
    import("../pages/settings/AccountsPage").then((m) => ({ Component: m.AccountsPage })),
};

const detailModules: Readonly<Record<SettingsDetailId, LazyPage>> = {
  passkey: () =>
    import("../pages/settings/PasskeyPage").then((m) => ({ Component: m.PasskeyPage })),
  share: () => import("../pages/settings/SharePage").then((m) => ({ Component: m.SharePage })),
  link: () =>
    import("../pages/settings/PublicLinkPage").then((m) => ({ Component: m.PublicLinkPage })),
  token: () =>
    import("../pages/settings/ApiTokenPage").then((m) => ({ Component: m.ApiTokenPage })),
};

/** A path of the tree relative to `/settings`, as a child route takes it. */
const relative = (path: string): string => path.slice(settingsRootPath.length + 1);

/** An old address: the same query and part of the page, at the new one. */
function MovedTo({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

/** `/settings` and everything under it (docs/architecture.md §14), built from the tree. */
export const settingsRoute: RouteObject = {
  path: "settings",
  lazy: () => import("./SettingsShell").then((m) => ({ Component: m.SettingsShell })),
  children: [
    {
      index: true,
      lazy: () => import("./SettingsIndex").then((m) => ({ Component: m.SettingsIndex })),
    },
    ...settingsPageNodes.flatMap((page): RouteObject[] => [
      { path: relative(page.path), lazy: pageModules[page.id as SettingsPageId] },
      ...(page.details ?? []).map((detail) => ({
        path: relative(detail.path),
        lazy: detailModules[detail.id as SettingsDetailId],
      })),
    ]),
    ...settingsRedirects.map((redirect) => ({
      path: relative(redirect.from),
      element: <MovedTo to={redirect.to} />,
    })),
  ],
};
