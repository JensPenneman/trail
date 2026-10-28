import type { ReactNode } from "react";
import { useFormatter } from "../format/useFormatter";
import { RelativeTime } from "../ui/RelativeTime";
import { OnMapBadge } from "./OnMapBadge";
import { PersonAvatar } from "./PersonAvatar";
import "./PersonSummary.css";

interface PersonSummaryProps {
  /** The heading: their name, or "Me". */
  title: string;
  titleId: string;
  /** h2 for Me, a part of the page; h3 for a card in the list of people. */
  level: 2 | 3;
  /** Whose initials the avatar shows, in which colour (`me`: the accent). */
  avatar: { name: string; slot: number | "me" };
  /**
   * When their position was recorded and whether that is live; null without
   * one. `asOf`: it would be live, but it comes from a copy too old to say so
   * (the stream is not open) — the time stands in for "Live".
   */
  freshness: { recordedAt: string; live: boolean; asOf?: boolean } | null;
  /** What they are doing now, or why nothing can be said ("No recent location"). */
  doing: string | null;
  /** Right of the name: the distance from you. */
  distance?: ReactNode;
  /** Right of the name, before the distance: the battery, when their share includes it. */
  battery?: ReactNode;
  /** Whether the map shows them now. */
  onMap: boolean;
}

/**
 * A person at a glance, in two lines as Find My has them: who, with a
 * battery glyph and how far on the right — "Ana Bell … ▮ 1.8 km" — then how
 * fresh and what they are doing: "Live · Cycling · 16 km/h" while the
 * position is live (its time on hover and in Details), "40 min ago · Walking"
 * after. A long name ends in an ellipsis rather than taking a line more.
 */
export function PersonSummary({
  title,
  titleId,
  level,
  avatar,
  freshness,
  doing,
  distance,
  battery,
  onMap,
}: PersonSummaryProps) {
  const format = useFormatter();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="person-summary">
      <PersonAvatar name={avatar.name} slot={avatar.slot} />
      <Heading className="person-summary__name" id={titleId}>
        {title}
      </Heading>
      {battery === undefined && distance === undefined ? null : (
        <div className="person-summary__aside">
          {battery === undefined ? null : (
            <span className="person-summary__battery">{battery}</span>
          )}
          {distance === undefined ? null : (
            <span className="person-summary__distance">{distance}</span>
          )}
        </div>
      )}
      <p className="person-summary__line">
        {freshness === null ? null : freshness.asOf === true ? (
          <time
            className="person-summary__fresh"
            dateTime={freshness.recordedAt}
            title={format.dateTime(freshness.recordedAt)}
          >
            as of {format.time(freshness.recordedAt)}
          </time>
        ) : freshness.live ? (
          <time
            className="person-summary__live"
            dateTime={freshness.recordedAt}
            title={format.dateTime(freshness.recordedAt)}
          >
            Live
          </time>
        ) : (
          <span className="person-summary__fresh">
            {doing === null ? "Updated " : null}
            <RelativeTime value={freshness.recordedAt} tickMs={15_000} />
          </span>
        )}
        {freshness === null || doing === null ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <span className="visually-hidden">, </span>
          </>
        )}
        {doing === null ? null : <span className="person-summary__doing">{unbroken(doing)}</span>}
      </p>
      {onMap ? (
        <div className="person-summary__badge">
          <OnMapBadge />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Breaks a line only after a " · ", never inside one of its parts ("18 km/h",
 * "within about 500 m") nor before the dot.
 */
const unbroken = (text: string): string =>
  text
    .split(" · ")
    .map((part) => part.replaceAll(" ", "\u00a0"))
    .join("\u00a0· ");
