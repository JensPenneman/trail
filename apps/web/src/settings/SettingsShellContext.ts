import type { CreateShareLinkResponse } from "@trail/contracts/shareLink";
import { createContext, useContext } from "react";

export interface SettingsShellState {
  /** The address just left by going back up the tree: its row takes focus again. */
  returnedFrom: string | null;
  /**
   * Public links made during this visit whose address has not been shown yet:
   * it exists only in the answer to making it, and is shown once, on the
   * link's page (PublicLinkPage). Memory only, never the browser's history.
   */
  freshLinks: Map<string, CreateShareLinkResponse>;
}

const outsideShell: SettingsShellState = { returnedFrom: null, freshLinks: new Map() };

export const SettingsShellContext = createContext<SettingsShellState>(outsideShell);

export function useSettingsShell(): SettingsShellState {
  return useContext(SettingsShellContext);
}
