import { useFormatter } from "../../format/useFormatter";
import { addDays } from "../../time/addDays";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { SegmentedControl } from "../../ui/SegmentedControl";
import type { HistorySelection } from "./HistorySelection";
import { RangeForm } from "./RangeForm";
import "./HistoryControls.css";

interface HistoryControlsProps {
  selection: HistorySelection;
  today: string;
  onDay: (date: string) => void;
  onRange: (from: string, to: string) => void;
  calendarId: string;
  calendarOpen: boolean;
  onToggleCalendar: () => void;
}

const modes = [
  { value: "day", label: "Day" },
  { value: "range", label: "Period" },
] as const;

/** Day stepping (with the calendar toggle) or a from–to period. */
export function HistoryControls({
  selection,
  today,
  onDay,
  onRange,
  calendarId,
  calendarOpen,
  onToggleCalendar,
}: HistoryControlsProps) {
  const format = useFormatter();
  return (
    <div className="history-controls">
      <SegmentedControl
        label="Show one day or a period"
        value={selection.mode}
        options={modes}
        onChange={(mode) => {
          if (mode === "day") onDay(selection.to);
          else onRange(addDays(selection.to, -6), selection.to);
        }}
      />
      {selection.mode === "day" ? (
        <div className="history-controls__day">
          <div className="history-controls__stepper">
            <Button icon="chevronLeft" iconOnly onClick={() => onDay(addDays(selection.from, -1))}>
              Previous day
            </Button>
            <button
              type="button"
              className="history-controls__date"
              aria-expanded={calendarOpen}
              aria-controls={calendarId}
              onClick={onToggleCalendar}
            >
              <Icon name="calendar" />
              <span className="history-controls__date-label">{format.day(selection.from)}</span>
              <span className="visually-hidden">, choose another day</span>
              <Icon name="chevronDown" className="history-controls__chevron" />
            </button>
            <Button
              icon="chevronRight"
              iconOnly
              disabled={selection.from >= today}
              onClick={() => onDay(addDays(selection.from, 1))}
            >
              Next day
            </Button>
          </div>
          {selection.from === today ? null : (
            <Button variant="ghost" onClick={() => onDay(today)}>
              Today
            </Button>
          )}
        </div>
      ) : (
        <RangeForm
          key={`${selection.from}:${selection.to}`}
          from={selection.from}
          to={selection.to}
          today={today}
          onApply={onRange}
        />
      )}
    </div>
  );
}
