import { type FormEvent, useId, useState } from "react";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import {
  type InsightsPeriodChoice,
  type InsightsSearch,
  insightsPeriods,
  isInsightsRange,
} from "./insightsSearch";
import "../map/FilterChips.css";
import "./PeriodPicker.css";

const labels: Readonly<Record<InsightsPeriodChoice, string>> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  year: "This year",
  all: "All",
  custom: "Custom",
};

interface PeriodPickerProps {
  search: InsightsSearch;
  /** The days the shown period covers, to start a custom one from. */
  range: { from: string | null; to: string };
  today: string;
  onPeriod: (period: (typeof insightsPeriods)[number]) => void;
  onRange: (from: string, to: string) => void;
}

/**
 * The period every number and chart below covers: presets in a row of chips,
 * and a custom range of days (at most three years) behind the last one.
 */
export function PeriodPicker({ search, range, today, onPeriod, onRange }: PeriodPickerProps) {
  const name = useId();
  const [customOpen, setCustomOpen] = useState(search.period === "custom");
  const [first, setFirst] = useState(search.from ?? range.from ?? today);
  const [last, setLast] = useState(search.to ?? range.to);
  const [error, setError] = useState<string | null>(null);
  // The chip chosen shows at once; the address follows a moment later (a new key resets it).
  const [picked, setPicked] = useState<InsightsPeriodChoice | null>(null);
  const shown: InsightsPeriodChoice = customOpen ? "custom" : (picked ?? search.period);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (first === "" || last === "") {
      setError("Enter both days.");
    } else if (first > last) {
      setError("The first day must come before the last day.");
    } else if (!isInsightsRange(first, last)) {
      setError("A period can span at most three years.");
    } else {
      setError(null);
      onRange(first, last);
    }
  };

  return (
    <div className="period-picker">
      <fieldset className="filter-chips">
        <legend className="filter-chips__legend">Period</legend>
        <div className="filter-chips__options">
          {[...insightsPeriods, "custom" as const].map((choice) => (
            <label
              key={choice}
              className={
                choice === shown
                  ? "filter-chip period-picker__chip is-on"
                  : "filter-chip period-picker__chip"
              }
            >
              <input
                type="radio"
                name={name}
                value={choice}
                checked={choice === shown}
                onChange={() => {
                  if (choice === "custom") {
                    setCustomOpen(true);
                    return;
                  }
                  setCustomOpen(false);
                  setError(null);
                  setPicked(choice);
                  onPeriod(choice);
                }}
              />
              <span>{labels[choice]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {customOpen ? (
        <form className="period-picker__range" onSubmit={onSubmit} noValidate>
          <TextField
            label="From"
            type="date"
            value={first}
            max={today}
            required
            onChange={(event) => setFirst(event.currentTarget.value)}
          />
          <TextField
            label="To"
            type="date"
            value={last}
            max={today}
            required
            error={error}
            onChange={(event) => setLast(event.currentTarget.value)}
          />
          <Button type="submit" variant="primary" className="period-picker__apply">
            Show
          </Button>
        </form>
      ) : null}
    </div>
  );
}
