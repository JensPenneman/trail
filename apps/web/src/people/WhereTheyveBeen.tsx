import type { Person } from "@trail/contracts/person";
import type { Formatter } from "../format/createFormatter";
import { useFormatter } from "../format/useFormatter";
import { addDays } from "../time/addDays";
import { localDateOf } from "../time/localDateOf";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useAnnounce } from "../ui/useAnnounce";
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
  /** Whether another day opens History (from Live), which is then announced as well. */
  opensHistory: boolean;
}

interface WhereTheyveBeenProps {
  person: Person;
  period: WhereTheyveBeenPeriod;
  /** Their track as the view asked for it; null when it asked for none (no device shown). */
  track: PersonTrackState | null;
  /** The card's heading, which says whose day the buttons step. */
  titleId: string;
  now: number;
}

/**
 * Where someone who is on the map has been, on their card: the day with a
 * way to the one before and after — no further back than the history they
 * share, since every look there counts in their access log — and their track
 * for it in a line, "14.9 km · 06:30 – 07:15", from what their share's track
 * holds and no more; a share without history says so instead. A day stepped
 * to is announced, and so is History when Live hands over to it.
 */
export function WhereTheyveBeen({ person, period, track, titleId, now }: WhereTheyveBeenProps) {
  const format = useFormatter();
  const announce = useAnnounce();
  const { day, onDay, today } = period;
  const historyDays = person.share.historyDays;
  // The first local day their history reaches into: a day before it would show nothing.
  const firstDay =
    historyDays === null ? today : localDateOf(now - historyDays * 86_400_000, format.timeZone);
  const label =
    day === null
      ? `${format.day(period.from)} – ${format.day(period.to)}`
      : day === today
        ? "Today"
        : format.day(day);
  const step = (date: string) => {
    if (onDay === null) return;
    onDay(date);
    const name = date === today ? "Today" : format.dayLong(date);
    announce(period.opensHistory ? `History, ${name}.` : `${name}.`);
  };

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
              // Never disabled: a disabled button would drop the keyboard's focus at the end.
              <Button
                icon="chevronLeft"
                iconOnly
                variant="ghost"
                aria-describedby={titleId}
                aria-disabled={day <= firstDay}
                onClick={() => {
                  if (day > firstDay) step(addDays(day, -1));
                }}
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
                aria-disabled={day >= today}
                onClick={() => {
                  if (day < today) step(addDays(day, 1));
                }}
              >
                Next day
              </Button>
            )}
          </div>
          {track === null ? (
            <p className="where-been__line">
              {person.devices.length === 0
                ? "Shares no device right now"
                : "None of their devices is shown (Map options)."}
            </p>
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
            <TrackLine summary={track.summary} person={person} period={period} format={format} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "14.9 km · 06:30 – 07:15", with words for what the times are for a screen
 * reader ("14.9 km, from 06:30 to 07:15"), or why there is nothing to say.
 */
function TrackLine({
  summary,
  person,
  period,
  format,
}: {
  summary: PersonTrackSummary;
  person: Person;
  period: WhereTheyveBeenPeriod;
  format: Formatter;
}) {
  const days = person.share.historyDays;
  const only =
    days === null ? null : `Shares the last ${days === 1 ? "24 hours" : `${days} days`} only`;
  if (summary.points === 0 || summary.firstAt === null || summary.lastAt === null) {
    const nothing =
      summary.limited && only !== null
        ? only
        : period.day === null
          ? "Nothing recorded in this period"
          : period.day === period.today
            ? "Nothing recorded today yet"
            : `Nothing recorded on ${format.day(period.day)}`;
    return <p className="where-been__line">{nothing}</p>;
  }
  const when = (instant: string) =>
    period.day === null ? format.dayTime(instant) : format.time(instant);
  const distance = format.distance(summary.distanceM);
  const [first, last] = [when(summary.firstAt), when(summary.lastAt)];
  const more = [
    ...(summary.devices > 1 ? [`${format.count(summary.devices)} devices recorded`] : []),
    ...(summary.limited && only !== null ? [only.toLowerCase()] : []),
  ];
  return (
    <p className="where-been__line">
      <span aria-hidden="true">{[`${distance} · ${first} – ${last}`, ...more].join(" · ")}</span>
      <span className="visually-hidden">
        {[`${distance}, from ${first} to ${last}`, ...more].join(", ")}
      </span>
    </p>
  );
}
