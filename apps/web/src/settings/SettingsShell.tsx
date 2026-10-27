import type { CreateShareLinkResponse } from "@trail/contracts/shareLink";
import { useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { useMediaQuery } from "../ui/useMediaQuery";
import { SettingsNavigation } from "./SettingsNavigation";
import { SettingsShellContext, type SettingsShellState } from "./SettingsShellContext";
import { settingsPlaceOf } from "./settingsTree";
import { sideBySide } from "./sideBySide";
import "./SettingsShell.css";

type Motion = "none" | "push" | "pop";

/**
 * The frame of Settings. On phones each page has the screen to itself and
 * moving deeper slides the new page in from the right, coming back from the
 * left (not at all with reduced motion); on wide screens the list stands
 * beside the page, as in the Mac's System Settings. Coming back, focus
 * returns to the row of the page that was left.
 */
export function SettingsShell() {
  const { pathname } = useLocation();
  const wide = useMediaQuery(sideBySide);
  const [move, setMove] = useState<{ path: string; motion: Motion; returnedFrom: string | null }>({
    path: pathname,
    motion: "none",
    returnedFrom: null,
  });
  if (move.path !== pathname) {
    const back = settingsPlaceOf(pathname).level < settingsPlaceOf(move.path).level;
    setMove({
      path: pathname,
      motion: back ? "pop" : "push",
      returnedFrom: back ? move.path : null,
    });
  }
  const [freshLinks] = useState(() => new Map<string, CreateShareLinkResponse>());
  const state = useMemo<SettingsShellState>(
    () => ({ returnedFrom: move.returnedFrom, freshLinks }),
    [move.returnedFrom, freshLinks],
  );
  const atRoot = settingsPlaceOf(pathname).level === 0;
  return (
    <SettingsShellContext value={state}>
      <div className="settings-shell">
        {wide && !atRoot ? (
          <div className="settings-shell__sidebar">
            <SettingsNavigation placement="sidebar" />
          </div>
        ) : null}
        <div className="settings-shell__page" key={pathname} data-motion={move.motion}>
          <Outlet />
        </div>
      </div>
    </SettingsShellContext>
  );
}
