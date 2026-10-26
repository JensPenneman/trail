import { createBrowserRouter, type RouteObject, replace } from "react-router";
import { NotFoundPage } from "../pages/notFound/NotFoundPage";
import { AppLoading } from "./AppLoading";
import { AppShell } from "./AppShell";
import { legacyMapPath } from "./legacyMapPath";
import { PublicLayout } from "./PublicLayout";
import { RequireSession } from "./RequireSession";
import { RootLayout } from "./RootLayout";
import { RouteError } from "./RouteError";
import { settingsSections } from "./settingsSections";

/**
 * Every page is its own chunk, fetched on first visit (the map library is
 * split further, inside the Map page). The previous page stays on screen
 * while the next one loads, with a progress bar in the shell.
 */
export function appRoutes(): RouteObject[] {
  return [
    {
      Component: RootLayout,
      HydrateFallback: AppLoading,
      ErrorBoundary: RouteError,
      children: [
        {
          Component: PublicLayout,
          children: [
            {
              path: "login",
              lazy: () =>
                import("../pages/login/LoginPage").then((m) => ({ Component: m.LoginPage })),
            },
            {
              path: "invite/:token",
              lazy: () =>
                import("../pages/invite/InvitePage").then((m) => ({ Component: m.InvitePage })),
            },
            {
              path: "link/:token",
              lazy: () => import("../pages/link/LinkPage").then((m) => ({ Component: m.LinkPage })),
            },
          ],
        },
        // The pages the Map page replaced: bookmarks and old links land on its views.
        {
          path: "history",
          loader: ({ request }) => replace(legacyMapPath(new URL(request.url), "history")),
        },
        {
          path: "explore",
          loader: ({ request }) => replace(legacyMapPath(new URL(request.url), "heat")),
        },
        {
          // A public link (`/s#<secret>`): no session, no navigation, a layout of its own.
          path: "s",
          lazy: () =>
            import("../pages/publicShare/PublicSharePage").then((m) => ({
              Component: m.PublicSharePage,
            })),
        },
        {
          Component: RequireSession,
          children: [
            {
              Component: AppShell,
              children: [
                {
                  index: true,
                  lazy: () =>
                    import("../pages/map/MapPage").then((m) => ({ Component: m.MapPage })),
                },
                {
                  path: "people",
                  lazy: () =>
                    import("../pages/people/PeoplePage").then((m) => ({ Component: m.PeoplePage })),
                },
                {
                  path: "devices",
                  lazy: () =>
                    import("../pages/devices/DevicesPage").then((m) => ({
                      Component: m.DevicesPage,
                    })),
                },
                {
                  path: "devices/:deviceId",
                  lazy: () =>
                    import("../pages/device/DevicePage").then((m) => ({ Component: m.DevicePage })),
                },
                {
                  path: "settings",
                  lazy: () =>
                    import("../pages/settings/SettingsLayout").then((m) => ({
                      Component: m.SettingsLayout,
                    })),
                  children: [
                    {
                      index: true,
                      lazy: () =>
                        import("../pages/settings/SettingsIndex").then((m) => ({
                          Component: m.SettingsIndex,
                        })),
                    },
                    ...settingsSections.map((section) => ({
                      path: section.id,
                      lazy: () =>
                        import("../pages/settings/SettingsSection").then((m) => ({
                          element: <m.SettingsSection id={section.id} />,
                        })),
                    })),
                  ],
                },
              ],
            },
          ],
        },
        { path: "*", Component: NotFoundPage },
      ],
    },
  ];
}

export function createAppRouter() {
  return createBrowserRouter(appRoutes());
}
