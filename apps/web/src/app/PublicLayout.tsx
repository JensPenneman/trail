import { Outlet } from "react-router";
import { Wordmark } from "../ui/Wordmark";
import { PublicBackdrop } from "./PublicBackdrop";
import { useRouteFocus } from "./useRouteFocus";
import "./PublicLayout.css";

/** Frame of the signed-out pages: sign in, invites, passkey links. */
export function PublicLayout() {
  useRouteFocus();
  return (
    <div className="public-layout">
      <PublicBackdrop />
      <main id="main" className="public-layout__main" tabIndex={-1}>
        <div className="public-layout__brand">
          <Wordmark size="l" />
        </div>
        <div className="public-layout__card">
          <Outlet />
        </div>
        <p className="public-layout__footer">
          Your location history, on your own server. Recorded with Overland for iOS.
        </p>
      </main>
    </div>
  );
}
