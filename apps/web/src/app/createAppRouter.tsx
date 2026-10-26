import { createBrowserRouter } from "react-router";
import { NotFoundPage } from "../pages/notFound/NotFoundPage";
import { AppLoading } from "./AppLoading";
import { AppShell } from "./AppShell";
import { PublicLayout } from "./PublicLayout";
import { RequireSession } from "./RequireSession";
import { RootLayout } from "./RootLayout";
import { RouteError } from "./RouteError";
import { settingsSections } from "./settingsSections";

/**
 * Every page is its own chunk, fetched on first visit (the map library is
 * split further, inside the map pages). The previous page stays on screen
 * while the next one loads, with a progress bar in the shell.
 */
export function createAppRouter() {
  return createBrowserRouter([
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
                    import("../pages/live/LivePage").then((m) => ({ Component: m.LivePage })),
                },
                {
                  path: "history",
                  lazy: () =>
                    import("../pages/history/HistoryPage").then((m) => ({
                      Component: m.HistoryPage,
                    })),
                },
                {
                  path: "explore",
                  lazy: () =>
                    import("../pages/explore/ExplorePage").then((m) => ({
                      Component: m.ExplorePage,
                    })),
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
  ]);
}
