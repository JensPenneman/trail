import { PersonAvatar } from "../../people/PersonAvatar";
import { me } from "./me";
import "./FilterChips.css";

interface PersonSelectorProps {
  /** Me first, then everyone sharing with the signed-in person (`slot` null for Me). */
  people: readonly { key: string; name: string; slot: number | null }[];
  selected: readonly string[];
  onChange: (people: readonly string[]) => void;
}

/**
 * Whose data the map shows: Me and the people sharing with me, and Everyone
 * once two or more share — a checkbox for all of them, "mixed" while some are
 * chosen. Somebody always stays chosen: an empty map explains nothing.
 */
export function PersonSelector({ people, selected, onChange }: PersonSelectorProps) {
  const all = people.map((person) => person.key);
  const isOn = (key: string) => selected.includes(key);
  const onCount = all.filter(isOn).length;
  const everyone = onCount === all.length;
  const toggle = (key: string, on: boolean) =>
    onChange(all.filter((candidate) => (candidate === key ? on : isOn(candidate))));
  return (
    <fieldset className="filter-chips">
      <legend className="filter-chips__legend">People</legend>
      <div className="filter-chips__options">
        {people.length > 2 ? (
          <label className={everyone ? "filter-chip is-on" : "filter-chip"}>
            <input
              type="checkbox"
              checked={everyone}
              ref={(input) => {
                if (input !== null) input.indeterminate = onCount > 0 && !everyone;
              }}
              // Everyone again leaves Me, the start.
              onChange={() => onChange(everyone ? [me] : all)}
            />
            <span>Everyone</span>
          </label>
        ) : null}
        {people.map((person) => {
          const on = isOn(person.key);
          return (
            <label key={person.key} className={on ? "filter-chip is-on" : "filter-chip"}>
              <input
                type="checkbox"
                checked={on}
                disabled={on && onCount === 1}
                onChange={(event) => toggle(person.key, event.currentTarget.checked)}
              />
              {person.slot === null ? null : (
                <PersonAvatar name={person.name} slot={person.slot} size="s" />
              )}
              <span>{person.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
