import { type ReactNode, useId } from "react";
import { PlainList } from "../../ui/PlainList";
import "./MapKey.css";

interface MapKeyItem {
  /** A colour for the swatch, as drawn on the map. */
  color: string;
  label: string;
}

interface MapKeyProps {
  /** The id the map's canvas points `aria-describedby` at. */
  id: string;
  title: string;
  /** What it covers ("Since 4 Nov 2023", "1–31 Oct 2026"), under the title. */
  detail?: string | null;
  /** The classes, from least to most; null while the answer is on its way or empty. */
  items: readonly MapKeyItem[] | null;
  /** The words at the two ends of the scale. */
  ends?: readonly [string, string];
  /** What is to be said instead of the classes ("Loading…", "Nothing in view for this period"). */
  status?: string | null;
  /** Further lines: the answer is incomplete, or still being worked out. */
  notes?: readonly ReactNode[];
}

/**
 * The key of what the map draws (docs/architecture.md §14): a titled section with its classes as a
 * list named by the title, small over the map's bottom-left corner. Sequential scales only; the
 * colour is never the only cue, each class says what it stands for.
 */
export function MapKey({ id, title, detail, items, ends, status, notes = [] }: MapKeyProps) {
  const titleId = useId();
  return (
    <section className="map-key" id={id} aria-labelledby={titleId}>
      <h2 className="map-key__title" id={titleId}>
        {title}
      </h2>
      {detail === null || detail === undefined ? null : <p className="map-key__detail">{detail}</p>}
      {items === null ? null : (
        <PlainList className="map-key__scale" labelledBy={titleId}>
          {ends === undefined ? null : (
            <li className="map-key__end" aria-hidden="true">
              {ends[0]}
            </li>
          )}
          {items.map((item) => (
            <li key={item.label} className="map-key__item">
              <span
                className="map-key__swatch"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
          {ends === undefined ? null : (
            <li className="map-key__end" aria-hidden="true">
              {ends[1]}
            </li>
          )}
        </PlainList>
      )}
      {status === null || status === undefined ? null : <p className="map-key__status">{status}</p>}
      {notes.map((note, index) => (
        // The notes are few and fixed in order.
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed short list
        <p key={index} className="map-key__status">
          {note}
        </p>
      ))}
    </section>
  );
}
