import { type FormEvent, useId, useState } from "react";
import { useFormatter } from "../../format/useFormatter";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { TextField } from "../../ui/TextField";
import { InsightsOptions } from "./InsightsOptions";
import { InsightsPopover } from "./InsightsPopover";
import { isInsightsRange, type PeriodUnit, periodDays, periodLabel } from "./insightsPeriod";
import type { InsightsPeriodState } from "./useInsightsPeriod";
import "./InsightsPeriodBar.css";

const units: readonly { value: PeriodUnit; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

/** The days of a custom period, from the form to the address. */
function RangeForm({
  first,
  last,
  today,
  onApply,
}: {
  first: string;
  last: string;
  today: string;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (from === "" || to === "") {
      setError("Enter both days.");
    } else if (from > to) {
      setError("The first day must come before the last day.");
    } else if (!isInsightsRange(from, to)) {
      setError("A period can span at most three years.");
    } else {
      setError(null);
      onApply(from, to);
    }
  };
  return (
    <form className="insights-bar__range" onSubmit={onSubmit} noValidate>
      <TextField
        label="From"
        type="date"
        value={from}
        max={today}
        required
        onChange={(event) => setFrom(event.currentTarget.value)}
      />
      <TextField
        label="To"
        type="date"
        value={to}
        max={today}
        required
        error={error}
        onChange={(event) => setTo(event.currentTarget.value)}
      />
      <Button type="submit" variant="primary" className="insights-bar__apply">
        Show
      </Button>
    </form>
  );
}

/**
 * Under every screen's title: the unit of the period (week, month, year, all),
 * the period itself with steppers to the one before and after, a way to a
 * custom range, and the options (the devices counted).
 */
export function InsightsPeriodBar({ state }: { state: InsightsPeriodState }) {
  const format = useFormatter();
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const { period, today } = state;
  const shown = period.kind;
  const calendar = period.kind === "week" || period.kind === "month" || period.kind === "year";
  const before = state.neighbour(-1);
  const after = state.neighbour(1);
  const label = periodLabel(period, format);
  const days = periodDays(period, today);
  return (
    <div className="insights-bar">
      <SegmentedControl<PeriodUnit | "custom">
        label="Period"
        value={shown}
        options={units}
        onChange={(value) => {
          if (value !== "custom") state.chooseUnit(value);
        }}
      />
      <div className="insights-bar__row">
        {calendar ? (
          <Button
            variant="ghost"
            iconOnly
            icon="chevronLeft"
            aria-disabled={before === null ? true : undefined}
            onClick={() => state.step(-1)}
          >
            {`Previous ${period.kind}`}
          </Button>
        ) : null}
        <InsightsPopover
          open={open}
          onOpenChange={setOpen}
          popoverId={popoverId}
          button={(props) => (
            <button type="button" className="insights-bar__label" {...props}>
              <Icon name="calendar" />
              <span className="insights-bar__label-text">{label}</span>
              <span className="visually-hidden">, choose a custom period</span>
              <Icon name="chevronDown" className="insights-bar__chevron" />
            </button>
          )}
        >
          {(done) => (
            <RangeForm
              first={days.first}
              last={days.last}
              today={today}
              onApply={(from, to) => {
                state.chooseRange(from, to);
                done();
              }}
            />
          )}
        </InsightsPopover>
        {calendar ? (
          <Button
            variant="ghost"
            iconOnly
            icon="chevronRight"
            aria-disabled={after === null ? true : undefined}
            onClick={() => state.step(1)}
          >
            {`Next ${period.kind}`}
          </Button>
        ) : null}
        <InsightsOptions state={state} />
      </div>
    </div>
  );
}
