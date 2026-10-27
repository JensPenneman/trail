import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { SettingsSearch } from "./SettingsSearch";
import { settingsPlaceOf } from "./settingsTree";
import { useSettingsTree } from "./useSettingsTree";
import "./SettingsNavigation.css";

/**
 * The tree's rows, group by group, with search above them: the root page on
 * phones and the sidebar beside every page on wide screens, where the row of
 * the page on screen is marked as current.
 */
export function SettingsNavigation({ placement }: { placement: "root" | "sidebar" }) {
  const tree = useSettingsTree();
  const { pathname } = useLocation();
  const [query, setQuery] = useState("");
  const results = query.trim() === "" ? null : tree.search(query);
  const current = settingsPlaceOf(pathname).page?.id;
  const titleAs = placement === "root" ? "h2" : "p";
  const ref = useRef<HTMLDivElement>(null);
  // The sidebar scrolls by itself: the row of the page on screen is kept in view there.
  useEffect(() => {
    if (placement !== "sidebar" || current === undefined) return;
    const row = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const box = ref.current?.parentElement;
    if (row === null || row === undefined || box === null || box === undefined) return;
    const rowBox = row.getBoundingClientRect();
    const viewBox = box.getBoundingClientRect();
    if (rowBox.top < viewBox.top) box.scrollTop -= viewBox.top - rowBox.top;
    else if (rowBox.bottom > viewBox.bottom) box.scrollTop += rowBox.bottom - viewBox.bottom;
  }, [placement, current]);
  return (
    <div ref={ref} className={`settings-navigation settings-navigation--${placement}`}>
      <SettingsSearch query={query} onQuery={setQuery} results={results} titleAs={titleAs} />
      {results === null ? (
        <nav className="settings-navigation__groups" aria-label="Settings">
          {tree.groups.map(({ group, rows }) => (
            <SettingsGroup
              key={group.id}
              title={group.label}
              titleAs={titleAs}
              {...(group.footer === undefined ? {} : { footer: group.footer })}
            >
              {rows.map(({ node, value }) =>
                node.kind === "external" ? (
                  <SettingsRow
                    key={node.id}
                    kind="external"
                    href={node.href}
                    icon={node.icon}
                    tone={node.tone}
                    label={node.label}
                    value={value}
                  />
                ) : (
                  <SettingsRow
                    key={node.id}
                    kind="link"
                    to={node.path}
                    icon={node.icon}
                    tone={node.tone}
                    label={node.label}
                    value={value}
                    current={placement === "sidebar" && current === node.id}
                  />
                ),
              )}
            </SettingsGroup>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
