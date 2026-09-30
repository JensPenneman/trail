import { type FormEvent, useState } from "react";
import { addDays } from "../../time/addDays";
import { daysBetween } from "../../time/daysBetween";
import { parseLocalDate } from "../../time/parseLocalDate";
import { shiftMonth } from "../../time/shiftMonth";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { maxRangeDays } from "./parseHistorySelection";
import "./RangeForm.css";

interface RangeFormProps {
  from: string;
  to: string;
  today: string;
  onApply: (from: string, to: string) => void;
}

/** First and last day of a period (both included), with shortcuts for the usual ones. */
export function RangeForm({ from, to, today, onApply }: RangeFormProps) {
  const [first, setFirst] = useState(from);
  const [last, setLast] = useState(to);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    { label: "Last 7 days", from: addDays(today, -6), to: today },
    { label: "Last 30 days", from: addDays(today, -29), to: today },
    { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    {
      label: "Last month",
      from: shiftMonth(`${today.slice(0, 7)}-01`, -1),
      to: addDays(`${today.slice(0, 7)}-01`, -1),
    },
  ];

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parseLocalDate(first) === null || parseLocalDate(last) === null) {
      setError("Enter both dates.");
      return;
    }
    if (first > last) {
      setError("The first day must come before the last day.");
      return;
    }
    if (daysBetween(first, last) >= maxRangeDays) {
      setError(`A period can span at most ${maxRangeDays} days.`);
      return;
    }
    setError(null);
    onApply(first, last);
  };

  return (
    <form className="range-form" onSubmit={onSubmit} noValidate>
      <div className="range-form__dates">
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
        <Button type="submit" variant="primary" className="range-form__apply">
          Show
        </Button>
      </div>
      <fieldset className="range-form__presets">
        <legend className="visually-hidden">Quick periods</legend>
        {presets.map((preset) => (
          <Button
            key={preset.label}
            variant="ghost"
            onClick={() => {
              setFirst(preset.from);
              setLast(preset.to);
              setError(null);
              onApply(preset.from, preset.to);
            }}
          >
            {preset.label}
          </Button>
        ))}
      </fieldset>
    </form>
  );
}
