import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { addDays } from "../../time/addDays";
import { firstDayOfWeek } from "../../time/firstDayOfWeek";
import { monthGrid } from "../../time/monthGrid";
import { parseLocalDate } from "../../time/parseLocalDate";
import { shiftMonth } from "../../time/shiftMonth";
import { Button } from "../../ui/Button";
import "./MonthCalendar.css";

export interface CalendarDay {
  points: number;
  /** Palette slots of the devices that recorded something that day. */
  slots: readonly number[];
}

interface MonthCalendarProps {
  id?: string;
  /** Any date in the month to show. */
  month: string;
  onMonthChange: (month: string) => void;
  selected: string;
  today: string;
  days: ReadonlyMap<string, CalendarDay>;
  loading: boolean;
  onSelect: (date: string) => void;
}

const firstOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;

/**
 * A month grid marking the days with recorded points. Arrow keys move by day
 * and week, Page Up/Down by month, Home/End to the week's ends (the grid keeps
 * a single tab stop); Enter or Space picks the day.
 */
export function MonthCalendar({
  id,
  month,
  onMonthChange,
  selected,
  today,
  days,
  loading,
  onSelect,
}: MonthCalendarProps) {
  const format = useFormatter();
  const titleId = useId();
  const visible = firstOfMonth(month);
  const parsed = parseLocalDate(visible) ?? { year: 2000, month: 1, day: 1 };
  const firstDay = firstDayOfWeek(format.locale);
  const weeks = useMemo(
    () => monthGrid(parsed.year, parsed.month, firstDay),
    [parsed.year, parsed.month, firstDay],
  );
  const weekdays = useMemo(() => format.weekdays(firstDay), [format, firstDay]);
  const [focused, setFocused] = useState(
    selected.startsWith(visible.slice(0, 7)) ? selected : visible,
  );
  const moveFocus = useRef(false);
  const gridRef = useRef<HTMLTableElement>(null);

  // Keep the roving tab stop inside the visible month.
  const tabStop = focused.startsWith(visible.slice(0, 7))
    ? focused
    : selected.startsWith(visible.slice(0, 7))
      ? selected
      : visible;

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${tabStop}"]`)?.focus();
  }, [tabStop]);

  const goTo = (date: string) => {
    const target = date > today ? today : date;
    moveFocus.current = true;
    setFocused(target);
    if (!target.startsWith(visible.slice(0, 7))) onMonthChange(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const offset = offsets[event.key];
    if (offset !== undefined) {
      event.preventDefault();
      goTo(addDays(tabStop, offset));
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      goTo(shiftMonth(tabStop, event.key === "PageUp" ? -1 : 1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const week = weeks.find((row) => row.includes(tabStop)) ?? [];
      const dates = week.filter((date): date is string => date !== null);
      const edge = event.key === "Home" ? dates[0] : dates[dates.length - 1];
      if (edge !== undefined) goTo(edge);
    }
  };

  const atCurrentMonth = visible >= firstOfMonth(today);

  return (
    <div className="calendar" id={id}>
      <div className="calendar__header">
        <Button
          variant="ghost"
          icon="chevronLeft"
          iconOnly
          onClick={() => onMonthChange(shiftMonth(visible, -1))}
        >
          Previous month
        </Button>
        <h3 className="calendar__title" id={titleId} aria-live="polite">
          {format.month(parsed.year, parsed.month)}
        </h3>
        <Button
          variant="ghost"
          icon="chevronRight"
          iconOnly
          disabled={atCurrentMonth}
          onClick={() => onMonthChange(shiftMonth(visible, 1))}
        >
          Next month
        </Button>
      </div>
      <table
        ref={gridRef}
        className={loading ? "calendar__grid is-loading" : "calendar__grid"}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the APG date-picker grid; the role makes screen readers pass arrow keys to the roving focus
        role="grid"
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th key={weekday.long} scope="col" abbr={weekday.long}>
                {weekday.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.find((date) => date !== null) ?? "empty"}>
              {week.map((date, index) => {
                if (date === null) {
                  // biome-ignore lint/suspicious/noArrayIndexKey: empty cells have no identity but their position
                  return <td key={`blank-${index}`} />;
                }
                const info = days.get(date);
                const future = date > today;
                const label = [
                  format.dayLong(date),
                  date === today ? "today" : null,
                  info === undefined
                    ? "nothing recorded"
                    : `${format.count(info.points)} ${info.points === 1 ? "point" : "points"}`,
                ]
                  .filter((part) => part !== null)
                  .join(", ");
                const classes = ["calendar__day"];
                if (date === selected) classes.push("is-selected");
                if (date === today) classes.push("is-today");
                if (info !== undefined) classes.push("has-data");
                return (
                  <td key={date}>
                    <button
                      type="button"
                      className={classes.join(" ")}
                      data-date={date}
                      tabIndex={date === tabStop ? 0 : -1}
                      aria-label={label}
                      aria-pressed={date === selected}
                      disabled={future}
                      onClick={() => {
                        setFocused(date);
                        onSelect(date);
                      }}
                      onFocus={() => setFocused(date)}
                    >
                      <span className="calendar__number">{Number(date.slice(8))}</span>
                      <span className="calendar__marks" aria-hidden="true">
                        {(info?.slots ?? []).slice(0, 3).map((slot) => (
                          <span key={slot} className={`calendar__mark device-color-${slot}`} />
                        ))}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="calendar__legend">
        <span className="calendar__mark calendar__mark--legend" aria-hidden="true" /> A dot per
        device marks the days with recorded points.
      </p>
    </div>
  );
}
