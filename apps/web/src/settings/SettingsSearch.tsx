import { type FormEvent, useId } from "react";
import { useLocation, useNavigate } from "react-router";
import { Icon } from "../ui/Icon";
import { SettingsGroup } from "./SettingsGroup";
import { type SettingsLocationState, SettingsRow } from "./SettingsRow";
import type { SettingsSearchEntry } from "./settingsSearchIndex";
import "../ui/Field.css";
import "./SettingsSearch.css";

interface SettingsSearchProps {
  query: string;
  onQuery: (query: string) => void;
  /** The matches for `query`; null while there is no query. */
  results: readonly SettingsSearchEntry[] | null;
  /** Where the results stand: on a page (a heading) or in the sidebar (a label). */
  titleAs: "h2" | "p";
}

/**
 * Search over every page of Settings and the parts of them, by name and by
 * other words for them; the matches replace the groups while there is a
 * query, each with where it is ("Privacy & data › Your data"). Enter opens the
 * first one.
 */
export function SettingsSearch({ query, onQuery, results, titleAs }: SettingsSearchProps) {
  const id = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const first = results?.[0];
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (first === undefined) return;
    if (first.external) {
      window.location.assign(first.to);
      return;
    }
    const state: SettingsLocationState = { settingsFrom: pathname };
    void navigate(first.to, { state });
  };
  return (
    <>
      <search>
        <form className="settings-search" onSubmit={onSubmit}>
          <label className="visually-hidden" htmlFor={id}>
            Search Settings
          </label>
          <Icon name="search" className="settings-search__icon" />
          <input
            id={id}
            type="search"
            className="input settings-search__input"
            placeholder="Search"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(event) => onQuery(event.currentTarget.value)}
          />
        </form>
      </search>
      <p className="visually-hidden" role="status">
        {results === null
          ? ""
          : results.length === 0
            ? "No results"
            : `${results.length} ${results.length === 1 ? "result" : "results"}`}
      </p>
      {results === null ? null : results.length === 0 ? (
        <p className="settings-search__empty">No settings match “{query.trim()}”.</p>
      ) : (
        <SettingsGroup title="Results" titleAs={titleAs}>
          {results.map((result) =>
            result.external ? (
              <SettingsRow
                key={result.key}
                kind="external"
                href={result.to}
                icon={result.icon}
                tone={result.tone}
                label={result.label}
                detail={result.trail}
              />
            ) : (
              <SettingsRow
                key={result.key}
                kind="link"
                to={result.to}
                icon={result.icon}
                tone={result.tone}
                label={result.label}
                detail={result.trail}
              />
            ),
          )}
        </SettingsGroup>
      )}
    </>
  );
}
