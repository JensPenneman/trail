import { SettingsNavigation } from "./SettingsNavigation";
import type { ShellAddress } from "./SettingsShellContext";
import { SideBySideShell } from "./SideBySideShell";
import { settingsPlaceOf } from "./settingsTree";

const levelOf = (pathname: string): number => settingsPlaceOf(pathname).level;
const keyOf = ({ pathname }: ShellAddress): string => pathname;
const sidebar = <SettingsNavigation placement="sidebar" />;

/** The frame of Settings: its list beside every page on wide screens, one page at a time on phones. */
export function SettingsShell() {
  return <SideBySideShell levelOf={levelOf} keyOf={keyOf} sidebar={sidebar} />;
}
