import { SideBySideShell } from "../../settings/SideBySideShell";
import { InsightsList } from "./InsightsList";
import { keyOf, levelOf } from "./insightsLevels";

const sidebar = <InsightsList placement="sidebar" />;

/**
 * The frame of Insights: its list beside every screen on wide screens, one
 * screen at a time on phones, where the list belongs to the summary.
 */
export function InsightsShell() {
  return <SideBySideShell levelOf={levelOf} keyOf={keyOf} sidebar={sidebar} sidebarAtRoot />;
}
