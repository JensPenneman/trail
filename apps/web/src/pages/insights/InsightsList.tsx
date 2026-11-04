import { useLocation } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { useInsightsOverview } from "../../queries/useInsightsOverview";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { transportModeInfo } from "../../transport/transportModes";
import { insightsRootPath } from "./insightsLevels";
import { insightsLink } from "./insightsLinks";
import { useInsightsPeriod } from "./useInsightsPeriod";
import "./InsightsList.css";

const patterns = [
  { path: "/insights/time", label: "When you travel", icon: "calendar", tone: "blue" },
  { path: "/insights/roads", label: "Roads", icon: "route", tone: "orange" },
] as const;

/**
 * The screens of Insights as rows: the summary, the modes with their parts of
 * the distance, and the patterns. Beside every screen on wide screens (with
 * the summary as a row of its own); on phones part of the summary screen.
 */
export function InsightsList({ placement }: { placement: "root" | "sidebar" }) {
  const state = useInsightsPeriod();
  const format = useFormatter();
  const { pathname } = useLocation();
  const overview = useInsightsOverview(state.query());
  const titleAs = placement === "root" ? "h2" : "p";
  // Beside the screens a pressed row has the focus already; a list in the summary hands it back.
  const returnFocus = placement === "root";
  const path = pathname.replace(/\/+$/, "");
  const shownMode = path.startsWith("/insights/transport/") ? path.split("/")[3] : undefined;
  const modes = overview.data?.modes ?? [];
  // The mode on screen has a row even when it had no moves, so that the list says where one is.
  const rows = [
    ...modes.map((entry) => ({
      mode: entry.mode,
      value: `${format.distance(entry.distanceM)} · ${format.percent(entry.share)}`,
    })),
    ...(shownMode !== undefined &&
    Object.hasOwn(transportModeInfo, shownMode) &&
    !modes.some((entry) => entry.mode === shownMode)
      ? [{ mode: shownMode as keyof typeof transportModeInfo, value: "None" }]
      : []),
  ];
  return (
    <nav className={`insights-list insights-list--${placement}`} aria-label="Insights">
      {placement === "sidebar" ? (
        <SettingsGroup>
          <SettingsRow
            kind="link"
            to={insightsLink(insightsRootPath, state.params)}
            icon="insights"
            tone="indigo"
            label="Summary"
            value={
              overview.data === undefined ? null : format.distance(overview.data.totals.distanceM)
            }
            current={path === insightsRootPath}
            returnFocus={returnFocus}
          />
        </SettingsGroup>
      ) : null}
      {rows.length === 0 ? null : (
        <SettingsGroup title="Modes" titleAs={titleAs}>
          {rows.map((row) => (
            <SettingsRow
              key={row.mode}
              kind="link"
              to={insightsLink(`/insights/transport/${row.mode}`, state.params)}
              icon={transportModeInfo[row.mode].icon}
              tone="gray"
              label={transportModeInfo[row.mode].label}
              value={row.value}
              current={shownMode === row.mode}
              returnFocus={returnFocus}
            />
          ))}
        </SettingsGroup>
      )}
      <SettingsGroup title="Patterns" titleAs={titleAs}>
        {patterns.map((pattern) => (
          <SettingsRow
            key={pattern.path}
            kind="link"
            to={insightsLink(pattern.path, state.params)}
            icon={pattern.icon}
            tone={pattern.tone}
            label={pattern.label}
            current={path === pattern.path}
            returnFocus={returnFocus}
          />
        ))}
      </SettingsGroup>
    </nav>
  );
}
