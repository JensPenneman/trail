import type { QueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@trail/contracts/user";
import { Outlet } from "react-router";
import { vi } from "vitest";
import { useRouteFocus } from "../../src/app/useRouteFocus";
import { insightsRoute } from "../../src/pages/insights/insightsRoutes";
import { user as defaultUser } from "./fixtures";
import { renderPage } from "./renderPage";

/** What Insights takes from the signed-in frame: the main landmark and focus after navigating. */
function Frame() {
  useRouteFocus();
  return (
    <main>
      <Outlet />
    </main>
  );
}

/** A screen as wide as the query asks: the list beside the screen from 64rem. */
function screenOf(wide: boolean) {
  return (query: string): MediaQueryList =>
    ({
      matches: wide && query === "(min-width: 64rem)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/**
 * Insights as the app routes it (shell and screens lazy, as in the build),
 * opened at `url` on a phone or, with `wide`, with the list beside the screen.
 */
export function renderInsights(
  url: string,
  options: {
    user?: SessionUser;
    wide?: boolean;
    queryClient?: QueryClient;
    before?: readonly string[];
  } = {},
) {
  vi.stubGlobal("matchMedia", screenOf(options.wide === true));
  return renderPage(null, {
    url,
    user: options.user ?? defaultUser,
    ...(options.queryClient === undefined ? {} : { queryClient: options.queryClient }),
    ...(options.before === undefined ? {} : { before: options.before }),
    routes: [
      { element: <Frame />, children: [insightsRoute] },
      { path: "*", element: <p>Elsewhere</p> },
    ],
  });
}
