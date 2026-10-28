import type { SessionUser } from "@trail/contracts/user";
import { Outlet } from "react-router";
import { vi } from "vitest";
import { useRouteFocus } from "../../src/app/useRouteFocus";
import { settingsRoute } from "../../src/settings/settingsRoutes";
import { user as defaultUser } from "./fixtures";
import { renderPage } from "./renderPage";

/** What Settings takes from the signed-in frame: the main landmark and focus after navigating. */
function Frame() {
  useRouteFocus();
  return (
    <main>
      <Outlet />
    </main>
  );
}

/** A screen as wide as the query asks: the list beside the page from 64rem. */
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
 * Settings as the app routes it (every page lazy, as in the build), opened at
 * `url` on a phone or, with `wide`, on a screen with the list beside the page.
 */
export function renderSettings(url: string, options: { user?: SessionUser; wide?: boolean } = {}) {
  vi.stubGlobal("matchMedia", screenOf(options.wide === true));
  return renderPage(null, {
    url,
    user: options.user ?? defaultUser,
    routes: [
      { element: <Frame />, children: [settingsRoute] },
      { path: "*", element: <p>Elsewhere</p> },
    ],
  });
}
