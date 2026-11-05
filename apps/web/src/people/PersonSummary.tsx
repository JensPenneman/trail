import type { ReactNode } from "react";
import { useFormatter } from "../format/useFormatter";
import { RelativeTime } from "../ui/RelativeTime";
import { PersonAvatar } from "./PersonAvatar";
import "./PersonSummary.css";

interface PersonSummaryProps {
  /** The heading: their name, or "Me". */
  title: string;
  /** The detail heading's id, for the region it names. */
  titleId?: string;
  /**
   * `2`: the heading of a person's detail, which takes focus when it opens;
   * `row`: no heading, the name is a part of the link around it in the list.
   */
  level: 2 | "row";
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
  /** After what they are doing, on the same line: "2 devices" on Me's page. */
  detail?: string;
  /** Right of the name: the distance from you. */
  distance?: ReactNode;
  /** Right of the name, before the distance: the battery, when their share includes it. */
  battery?: ReactNode;
}

/**
 * A person at a glance, in two lines as Find My has them: who, with a
 * battery glyph and how far on the right — "Ana Bell … ▮ 1.8 km" — then how
 * fresh and what they are doing: "Live · Cycling · 16 km/h" while the
 * position is live (its time on hover and in Details), "40 min ago · Walking"
 * after. In the list it is a row without a heading; in a person's detail it
 * carries the h2. A long name ends in an ellipsis rather than taking a line more.
 */
export function PersonSummary({
  title,
  titleId,
  level,
  avatar,
  freshness,
  doing,
  detail,
  distance,
  battery,
}: PersonSummaryProps) {
  const format = useFormatter();
  return (
    <div className="person-summary">
      <PersonAvatar name={avatar.name} slot={avatar.slot} />
      {level === "row" ? (
        <span className="person-summary__name">{title}</span>
      ) : (
        <h2 className="person-summary__name" id={titleId} tabIndex={-1} data-person-heading>
          {title}
        </h2>
      )}
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
        {detail === undefined ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <span className="visually-hidden">, </span>
            <span className="person-summary__doing">{unbroken(detail)}</span>
          </>
        )}
      </p>
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
