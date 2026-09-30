import { useState } from "react";
import { Link, Outlet, ScrollRestoration, useNavigation } from "react-router";
import { createLiveStore } from "../live/createLiveStore";
import { LiveStoreContext } from "../live/LiveStoreContext";
import { useServerEvents } from "../live/useServerEvents";
import { Wordmark } from "../ui/Wordmark";
import { AccountMenu } from "./AccountMenu";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { OfflineBanner } from "./OfflineBanner";
import { PrimaryNav } from "./PrimaryNav";
import { useDeviceStatusAnnouncements } from "./useDeviceStatusAnnouncements";
import { useRouteFocus } from "./useRouteFocus";
import "./AppShell.css";

/** The signed-in frame: header with navigation, the live event stream, and the page. */
export function AppShell() {
  const [liveStore] = useState(createLiveStore);
  useServerEvents(liveStore);
  useRouteFocus();
  useDeviceStatusAnnouncements();
  const navigation = useNavigation();

  return (
    <LiveStoreContext value={liveStore}>
      <div className="app-shell">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="app-header">
          <Link to="/" className="app-header__brand" aria-label="Trail, go to Live">
            <Wordmark />
          </Link>
          <PrimaryNav />
          <div className="app-header__end">
            <ConnectionIndicator />
            <AccountMenu />
          </div>
        </header>
        {navigation.state === "loading" ? (
          <div className="route-progress" aria-hidden="true" />
        ) : null}
        <OfflineBanner />
        <main id="main" className="app-main" tabIndex={-1}>
          <Outlet />
        </main>
        <ScrollRestoration />
      </div>
    </LiveStoreContext>
  );
}
