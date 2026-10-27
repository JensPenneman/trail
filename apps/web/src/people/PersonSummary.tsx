import type { ReactNode } from "react";
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
  /** When their position was recorded and whether that is live; null without one. */
  freshness: { recordedAt: string; live: boolean } | null;
  /** What they are doing now, or why nothing can be said ("No recent location"). */
  doing: string | null;
  /** Right of the name: the distance from you. */
  distance?: ReactNode;
  /** Right of what they do: the battery, when their share includes it. */
  battery?: ReactNode;
  /** Whether the map shows them now. */
  onMap: boolean;
}

/**
 * A person at a glance, in two lines as Find My has them: who, how fresh and
 * how far — "Ana Bell · Live, 2 min ago … 1.8 km" — then what they are doing,
 * with the battery beside it when it is shared — "Cycling · 16 km/h … 58%".
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
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="person-summary">
      <PersonAvatar name={avatar.name} slot={avatar.slot} />
      <div className="person-summary__top">
        <Heading className="person-summary__name" id={titleId}>
          {title}
        </Heading>
        {freshness === null ? null : (
          <p className="person-summary__fresh">
            {freshness.live ? (
              <>
                <span className="person-summary__live">Live</span>
                <span className="visually-hidden">, </span>
              </>
            ) : null}
            <RelativeTime value={freshness.recordedAt} tickMs={15_000} />
          </p>
        )}
      </div>
      {distance === undefined ? null : <div className="person-summary__distance">{distance}</div>}
      {doing === null ? null : <p className="person-summary__doing">{unbroken(doing)}</p>}
      {battery === undefined ? null : <div className="person-summary__battery">{battery}</div>}
      {onMap ? (
        <div className="person-summary__badge">
          <OnMapBadge />
        </div>
      ) : null}
    </div>
  );
}

/** Breaks a line after a " · " only, never inside "18 km/h" nor before the dot. */
const unbroken = (text: string): string =>
  text.replaceAll(/(\d) /g, "$1\u00a0").replaceAll(" · ", "\u00a0· ");
