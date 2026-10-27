import type { Person } from "@trail/contracts/person";
import type { Formatter } from "../format/createFormatter";
import { useFormatter } from "../format/useFormatter";
import { addDays } from "../time/addDays";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import type { PersonTrackState } from "./PersonTrackState";
import { sharesHistory } from "./sharesHistory";
import type { PersonTrackSummary } from "./summarizePersonTrack";
import "./WhereTheyveBeen.css";

/** The day or period whose track a card shows, and the way to another day. */
export interface WhereTheyveBeenPeriod {
  /** The day shown — today in Live, History's day — or null for History's period. */
  day: string | null;
  /** The period's first and last local day (the day twice for a day). */
  from: string;
  to: string;
  today: string;
  /** Another day (History's, or History from Live); null where days are not stepped. */
  onDay: ((date: string) => void) | null;
}

interface WhereTheyveBeenProps {
  person: Person;
  period: WhereTheyveBeenPeriod;
  /** Their track as the view asked for it; null when it asked for none (no device shown). */
  track: PersonTrackState | null;
  /** The card's heading, which says whose day the buttons step. */
  titleId: string;
}

/**
 * Where someone who is on the map has been, on their card: the day with a
 * way to the one before and after, and their track for it in a line —
 * "14.9 km · 06:30 – 07:15" — from what their share's track holds and no
 * more; a share without history says so instead.
 */
export function WhereTheyveBeen({ person, period, track, titleId }: WhereTheyveBeenProps) {
  const format = useFormatter();
  const { day, onDay, today } = period;
  const label =
    day === null
      ? `${format.day(period.from)} – ${format.day(period.to)}`
      : day === today
        ? "Today"
        : format.day(day);

  return (
    // No landmark: every card on the map has one, and its heading says what it is.
    <div className="where-been">
      <h4 className="where-been__title">Where they’ve been</h4>
      {!sharesHistory(person) ? (
        <p className="where-been__line">Shares live location only</p>
      ) : (
        <div className="where-been__body">
          <div className="where-been__day">
            {day === null || onDay === null ? null : (
              <Button
                icon="chevronLeft"
                iconOnly
                variant="ghost"
                aria-describedby={titleId}
                onClick={() => onDay(addDays(day, -1))}
              >
                Previous day
              </Button>
            )}
            <p className="where-been__label">{label}</p>
            {day === null || onDay === null ? null : (
              <Button
                icon="chevronRight"
                iconOnly
                variant="ghost"
                aria-describedby={titleId}
                disabled={day >= today}
                onClick={() => onDay(addDays(day, 1))}
              >
                Next day
              </Button>
            )}
          </div>
          {track === null ? (
            <p className="where-been__line">None of their devices is shown (Map options).</p>
          ) : track.status === "pending" ? (
            <p className="where-been__line" aria-busy="true">
              <span className="visually-hidden">Loading their track</span>
              <Skeleton height="1rem" width="10rem" />
            </p>
          ) : track.status === "error" ? (
            <p className="where-been__line where-been__line--error">
              Their track could not be loaded.
            </p>
          ) : (
            <p className="where-been__line">{trackLine(track.summary, person, period, format)}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** "14.9 km · 06:30 – 07:15", or why there is nothing to say. */
function trackLine(
  summary: PersonTrackSummary,
  person: Person,
  period: WhereTheyveBeenPeriod,
  format: Formatter,
): string {
  const days = person.share.historyDays;
  const only =
    days === null ? null : `Shares the last ${days === 1 ? "24 hours" : `${days} days`} only`;
  if (summary.points === 0 || summary.firstAt === null || summary.lastAt === null) {
    if (summary.limited && only !== null) return only;
    if (period.day === null) return "Nothing recorded in this period";
    return period.day === period.today
      ? "Nothing recorded today yet"
      : `Nothing recorded on ${format.day(period.day)}`;
  }
  const when = (instant: string) =>
    period.day === null ? format.dayTime(instant) : format.time(instant);
  const line = `${format.distance(summary.distanceM)} · ${when(summary.firstAt)} – ${when(summary.lastAt)}`;
  return summary.limited && only !== null ? `${line} · ${only.toLowerCase()}` : line;
}
