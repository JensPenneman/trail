import type { RouteObject } from "react-router";

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
      path: "time",
      lazy: () => import("./WhenScreen").then((m) => ({ Component: m.WhenScreen })),
    },
    {
      path: "roads",
      lazy: () => import("./RoadsScreen").then((m) => ({ Component: m.RoadsScreen })),
    },
  ],
};
