import { useId } from "react";
import { useFormatter } from "../../format/useFormatter";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { PlainList } from "../../ui/PlainList";
import type { PositionAtTime } from "./positionAt";
import "./TimeScrubber.css";

export interface ScrubberReadout {
  deviceId: string;
  name: string;
  slot: number;
  position: PositionAtTime | null;
}

interface TimeScrubberProps {
  /** Epoch seconds. */
  start: number;
  end: number;
  value: number;
  /** Show dates as well as times (periods longer than a day). */
  withDate: boolean;
  readouts: readonly ScrubberReadout[];
  onChange: (value: number) => void;
}

/**
 * A slider through the recorded time: the map marks where each device was at
 * that moment, and the same positions are written out below the slider.
 */
export function TimeScrubber({
  start,
  end,
  value,
  withDate,
  readouts,
  onChange,
}: TimeScrubberProps) {
  const format = useFormatter();
  const id = useId();
  const label = (seconds: number) =>
    withDate ? format.dayTime(seconds * 1000) : format.time(seconds * 1000);
  const span = Math.max(1, end - start);
  const step = span > 86_400 ? 300 : 30;

  return (
    <div className="scrubber">
      <div className="scrubber__top">
        <label className="scrubber__label" htmlFor={id}>
          Position at
        </label>
        <output className="scrubber__time" htmlFor={id}>
          {label(value)}
        </output>
      </div>
      <input
        id={id}
        className="scrubber__range"
        type="range"
        min={start}
        max={end}
        step={step}
        value={value}
        aria-valuetext={label(value)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <div className="scrubber__ends" aria-hidden="true">
        <span>{label(start)}</span>
        <span>{label(end)}</span>
      </div>
      <PlainList className="scrubber__readouts">
        {readouts.map((readout) => (
          <li key={readout.deviceId} className="scrubber__readout">
            <DeviceSwatch slot={readout.slot} />
            <span className="scrubber__device">{readout.name}</span>
            <span className="scrubber__where">
              {readout.position === null
                ? "no position recorded then"
                : `${format.coordinates(readout.position.lat, readout.position.lon)}${
                    readout.position.speed !== null && readout.position.speed >= 0.6
                      ? ` · ${format.speed(readout.position.speed)}`
                      : ""
                  }`}
            </span>
          </li>
        ))}
      </PlainList>
    </div>
  );
}
