import type { HeatMeasure } from "@trail/contracts/heatmap";
import { type TransportMode, transportModes } from "@trail/contracts/transport";
import { type FormEvent, useState } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { transportModeInfo } from "../../../transport/transportModes";
import { Button } from "../../../ui/Button";
import { SelectField } from "../../../ui/SelectField";
import { TextField } from "../../../ui/TextField";
import { hasMode, hasPeriod, heatChoices, heatMeasureInfo } from "./heatMeasures";
import { type HeatPeriod, presetOf, presetPeriod, resolveCustom } from "./heatPeriod";
import { periodLabel } from "./lensLabel";
import "./HeatOptions.css";

interface HeatOptionsProps {
  heat: HeatMeasure;
  onHeat: (heat: HeatMeasure) => void;
  /** The period in the address; null: all time. */
  period: HeatPeriod | null;
  onPeriod: (period: HeatPeriod | null) => void;
  today: string;
  /** One mode's moves, for the measures of movement; null: every mode. */
  mode: TransportMode | null;
  onMode: (mode: TransportMode | null) => void;
}

const customValue = "custom";

/**
 * Heat's part of the map options (docs/architecture.md §14): what the squares count and, for the
 * measures that cover a period, which. A preset shows when the address' dates match it relative to
 * today; any other period reads "Custom: 3 Oct – 2 Nov", and "Custom period…" opens the form.
 */
export function HeatOptions({
  heat,
  onHeat,
  period,
  onPeriod,
  today,
  mode,
  onMode,
}: HeatOptionsProps) {
  const format = useFormatter();
  const preset = presetOf(period, today);
  const [editing, setEditing] = useState(false);
  const showForm = hasPeriod(heat) && (editing || preset === "custom");

  const choose = (value: string) => {
    if (value === customValue) {
      setEditing(true);
      return;
    }
    setEditing(false);
    onPeriod(presetPeriod(value as "all" | "7d" | "30d" | "12m", today));
  };

  return (
    <div className="heat-options">
      <SelectField
        label="Heat by"
        value={heat}
        onChange={(event) => onHeat(event.currentTarget.value as HeatMeasure)}
      >
        {heatChoices.map((choice) => (
          <option key={choice} value={choice}>
            {heatMeasureInfo[choice].option}
          </option>
        ))}
      </SelectField>
      {hasMode(heat) ? (
        <SelectField
          label="Mode"
          value={mode ?? ""}
          onChange={(event) =>
            onMode(
              event.currentTarget.value === ""
                ? null
                : (event.currentTarget.value as TransportMode),
            )
          }
        >
          <option value="">Every mode</option>
          {transportModes
            .filter((choice) => choice !== "stationary")
            .map((choice) => (
              <option key={choice} value={choice}>
                {transportModeInfo[choice].label}
              </option>
            ))}
        </SelectField>
      ) : null}
      {hasPeriod(heat) ? (
        <>
          <SelectField
            label="Period"
            value={editing ? customValue : preset}
            onChange={(event) => choose(event.currentTarget.value)}
          >
            <option value="all">All time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="12m">Last 12 months</option>
            <option value={customValue}>
              {preset === "custom" && period !== null && !editing
                ? `Custom: ${periodLabel(period, format)}`
                : "Custom period…"}
            </option>
          </SelectField>
          {showForm ? (
            // Keyed by the period in the address: a preset, a lens or Back gives the form its dates.
            <CustomPeriod
              key={period === null ? "none" : `${period.from}/${period.to}`}
              period={period}
              today={today}
              onApply={(next) => {
                setEditing(false);
                onPeriod(next);
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

interface CustomPeriodProps {
  period: HeatPeriod | null;
  today: string;
  onApply: (period: HeatPeriod) => void;
}

/** From, To and Show period: the dates of the address, or today, and what is wrong with the ones typed. */
function CustomPeriod({ period, today, onApply }: CustomPeriodProps) {
  const [from, setFrom] = useState(period?.from ?? today);
  const [to, setTo] = useState(period?.to ?? today);
  const [error, setError] = useState<string | null>(null);
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = resolveCustom(from, to, today);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    onApply(result.period);
  };
  return (
    <form className="heat-options__custom" onSubmit={apply} noValidate>
      <div className="heat-options__dates">
        <TextField
          label="From"
          type="date"
          value={from}
          max={today}
          invalid={error !== null}
          onChange={(event) => setFrom(event.currentTarget.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          max={today}
          error={error}
          onChange={(event) => setTo(event.currentTarget.value)}
        />
      </div>
      <Button type="submit" variant="primary">
        Show period
      </Button>
    </form>
  );
}
