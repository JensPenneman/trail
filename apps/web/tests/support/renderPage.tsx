import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { SessionUser } from "@trail/contracts/user";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SessionUserContext } from "../../src/app/SessionUserContext";
import { createLiveStore } from "../../src/live/createLiveStore";
import { LiveStoreContext } from "../../src/live/LiveStoreContext";
import { AnnouncerProvider } from "../../src/ui/AnnouncerProvider";

/**
 * Renders one screen the way the app does — query cache, router, announcer,
 * live store and (for signed-in screens) the session user — without the
 * route guard or the event stream.
 */
export function renderPage(
  element: ReactElement,
  options: { path?: string; url?: string; user?: SessionUser | null } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  const liveStore = createLiveStore();
  const router = createMemoryRouter(
    [
      { path: options.path ?? "/", element },
      { path: "*", element: <p>Elsewhere</p> },
    ],
    { initialEntries: [options.url ?? options.path ?? "/"] },
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AnnouncerProvider>
        <SessionUserContext value={options.user ?? null}>
          <LiveStoreContext value={liveStore}>
            <RouterProvider router={router} />
          </LiveStoreContext>
        </SessionUserContext>
      </AnnouncerProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, router, liveStore };
}
