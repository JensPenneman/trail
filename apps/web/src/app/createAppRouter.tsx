import { createBrowserRouter } from "react-router";
import { NotFoundPage } from "../pages/notFound/NotFoundPage";
import { AppLoading } from "./AppLoading";
import { AppShell } from "./AppShell";
import { PublicLayout } from "./PublicLayout";
import { RequireSession } from "./RequireSession";
import { RootLayout } from "./RootLayout";
import { RouteError } from "./RouteError";

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
                    import("../pages/settings/SettingsPage").then((m) => ({
                      Component: m.SettingsPage,
                    })),
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
