import type { CreateShareLinkResponse } from "@trail/contracts/shareLink";
import { createContext, useContext } from "react";

/** The part of an address a shell tells its screens apart by (the path, and what a query adds). */
export interface ShellAddress {
  pathname: string;
  search: string;
}

export interface SettingsShellState {
  /** The key of the screen just left by going back up: its row takes focus again. */
  returnedFrom: string | null;
  /**
   * What tells one screen of the shell from another: the path alone for
   * Settings, a path with the item for a screen whose item is in the query.
   * Rows compare the key of their target with `returnedFrom`.
   */
  keyOf: (address: ShellAddress) => string;
  /**
   * Inside a shell of screens (Settings, Insights): the links of its rows
   * carry where they were opened from and take focus back. Outside one (the
   * People page's levels) the history carries nothing.
   */
  inShell: boolean;
  /**
   * Public links made during this visit whose address has not been shown yet:
   * it exists only in the answer to making it, and is shown once, on the
   * link's page (PublicLinkPage). Memory only, never the browser's history.
   */
  freshLinks: Map<string, CreateShareLinkResponse>;
}

const outsideShell: SettingsShellState = {
  returnedFrom: null,
  keyOf: ({ pathname }) => pathname,
  inShell: false,
  freshLinks: new Map(),
};

export const SettingsShellContext = createContext<SettingsShellState>(outsideShell);

export function useSettingsShell(): SettingsShellState {
  return useContext(SettingsShellContext);
}
