import type { RouteObject } from "react-router";
import { legacyInsightsRedirect } from "./legacyInsightsRedirect";

/** Insights: the shell, and each screen its own chunk, loaded on the first visit. */
export const insightsRoute: RouteObject = {
  path: "insights",
  lazy: () =>
    import("./InsightsShell").then((m) => ({
      Component: m.InsightsShell,
    })),
  children: [
    {
      index: true,
      lazy: () => import("./SummaryScreen").then((m) => ({ Component: m.SummaryScreen })),
    },
    {
      path: "transport/:mode",
      lazy: () => import("./ModeScreen").then((m) => ({ Component: m.ModeScreen })),
    },
    {
      path: "transport/:mode/time",
      lazy: () => import("./ModeWhenScreen").then((m) => ({ Component: m.ModeWhenScreen })),
    },
    {
      path: "transport/:mode/roads",
      lazy: () => import("./ModeRoadsScreen").then((m) => ({ Component: m.ModeRoadsScreen })),
    },
    {
      path: "transport/:mode/speed",
      lazy: () => import("./ModeSpeedScreen").then((m) => ({ Component: m.ModeSpeedScreen })),
    },
    {
      path: "transport/:mode/moves",
      lazy: () => import("./LongestMovesScreen").then((m) => ({ Component: m.LongestMovesScreen })),
    },
    {
      path: "places",
      lazy: () => import("./PlacesScreen").then((m) => ({ Component: m.PlacesScreen })),
    },
    {
      path: "place",
      lazy: () => import("./PlaceScreen").then((m) => ({ Component: m.PlaceScreen })),
    },
    {
      path: "place/days",
      lazy: () => import("./PlaceDaysScreen").then((m) => ({ Component: m.PlaceDaysScreen })),
    },
    {
      path: "time",
      loader: ({ request }) => legacyInsightsRedirect(request, "time"),
      lazy: () => import("./WhenScreen").then((m) => ({ Component: m.WhenScreen })),
    },
    {
      path: "roads",
      loader: ({ request }) => legacyInsightsRedirect(request, "roads"),
      lazy: () => import("./RoadsScreen").then((m) => ({ Component: m.RoadsScreen })),
    },
  ],
};
