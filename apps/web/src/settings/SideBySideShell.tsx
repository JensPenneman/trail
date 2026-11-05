import type { CreateShareLinkResponse } from "@trail/contracts/shareLink";
import { type ReactNode, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { useMediaQuery } from "../ui/useMediaQuery";
import {
  SettingsShellContext,
  type SettingsShellState,
  type ShellAddress,
} from "./SettingsShellContext";
import { sideBySide } from "./sideBySide";
import "./SideBySideShell.css";

type Motion = "none" | "push" | "pop";

interface SideBySideShellProps {
  /** How deep a path lies: 0 for the root screen, going back is going to a lower level. */
  levelOf: (pathname: string) => number;
  /** What tells one screen from another (the path, and the query where it holds the item). */
  keyOf: (address: ShellAddress) => string;
  /** The list that stands beside the screens on wide screens. */
  sidebar: ReactNode;
  /** Whether the list also stands beside the root screen (Insights), or the root is the list (Settings). */
  sidebarAtRoot?: boolean;
}

/**
 * The frame of the screens that stand beside a list. On phones each screen has
 * the display to itself and moving deeper slides the new one in from the right,
 * coming back from the left (not at all with reduced motion); on wide screens
 * the list stands beside the screen, as in the Mac's System Settings. Coming
 * back, focus returns to the row of the screen that was left.
 */
export function SideBySideShell({
  levelOf,
  keyOf,
  sidebar,
  sidebarAtRoot = false,
}: SideBySideShellProps) {
  const { pathname, search } = useLocation();
  const wide = useMediaQuery(sideBySide);
  const key = keyOf({ pathname, search });
  const [move, setMove] = useState<{
    key: string;
    pathname: string;
    motion: Motion;
    returnedFrom: string | null;
  }>({ key, pathname, motion: "none", returnedFrom: null });
  if (move.key !== key) {
    const back = levelOf(pathname) < levelOf(move.pathname);
    setMove({ key, pathname, motion: back ? "pop" : "push", returnedFrom: back ? move.key : null });
  }
  const [freshLinks] = useState(() => new Map<string, CreateShareLinkResponse>());
  const state = useMemo<SettingsShellState>(
    () => ({ returnedFrom: move.returnedFrom, keyOf, inShell: true, freshLinks }),
    [move.returnedFrom, keyOf, freshLinks],
  );
  const atRoot = levelOf(pathname) === 0;
  return (
    <SettingsShellContext value={state}>
      <div className="side-by-side">
        {wide && (sidebarAtRoot || !atRoot) ? (
          <div className="side-by-side__sidebar">{sidebar}</div>
        ) : null}
        <div className="side-by-side__page" key={key} data-motion={move.motion}>
          <Outlet />
        </div>
      </div>
    </SettingsShellContext>
  );
}
