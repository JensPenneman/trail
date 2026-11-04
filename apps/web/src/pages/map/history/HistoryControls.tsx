import { type ReactNode, useId } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { addDays } from "../../../time/addDays";
import { Button } from "../../../ui/Button";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import type { HistorySelection } from "./HistorySelection";
import { PeriodControl } from "./PeriodControl";
import { RangeForm } from "./RangeForm";
import "./HistoryControls.css";

interface HistoryControlsProps {
  selection: HistorySelection;
  today: string;
  onDay: (date: string) => void;
  onRange: (from: string, to: string) => void;
  /** Whether the date button's popover is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The month calendar, for a day; it gets `done` to call when a day is picked. */
  calendar: (done: () => void) => ReactNode;
  /** Opened from the panel (not the button): focus goes to the day shown. */
  focusIn: boolean;
}

const modes = [
  { value: "day", label: "Day" },
  { value: "range", label: "Period" },
] as const;

/**
 * History's row over the map: ‹ Previous day · the date ▾ · Next day › ·
 * Today. The date button opens a popover with Day | Period and the calendar
 * or the from–to form; a period has the button alone.
 */
export function HistoryControls({
  selection,
  today,
  onDay,
  onRange,
  open,
  onOpenChange,
  calendar,
  focusIn,
}: HistoryControlsProps) {
  const format = useFormatter();
  const popoverId = useId();
  const day = selection.mode === "day";
  const label = day
    ? format.day(selection.from)
    : `${format.day(selection.from)} – ${format.day(selection.to)}`;
  const today_ = selection.from === today;
  // One tree for a day and a period, so the date button never remounts when the mode changes.
  return (
    <div className="history-controls">
      {day ? (
        <Button icon="chevronLeft" iconOnly onClick={() => onDay(addDays(selection.from, -1))}>
          Previous day
        </Button>
      ) : null}
      <PeriodControl
        label={label}
        open={open}
        onOpenChange={onOpenChange}
        popoverId={popoverId}
        focusIn={focusIn}
      >
        {(done) => (
          <>
            <SegmentedControl
              label="Show one day or a period"
              value={selection.mode}
              options={modes}
              onChange={(mode) => {
                // Only the mode changes: the popover stays for the day or the period.
                if (mode === "day") onDay(selection.to);
                else onRange(addDays(selection.to, -6), selection.to);
              }}
            />
            {day ? (
              calendar(done)
            ) : (
              <RangeForm
                key={`${selection.from}:${selection.to}`}
                from={selection.from}
                to={selection.to}
                today={today}
                onApply={(from, to) => {
                  onRange(from, to);
                  done();
                }}
              />
            )}
          </>
        )}
      </PeriodControl>
      {day ? (
        <Button
          icon="chevronRight"
          iconOnly
          disabled={selection.from >= today}
          onClick={() => onDay(addDays(selection.from, 1))}
        >
          Next day
        </Button>
      ) : null}
      {day && !today_ ? (
        <Button variant="ghost" onClick={() => onDay(today)}>
          Today
        </Button>
      ) : null}
    </div>
  );
}
