import { type ProcessingLevel, processingLevels } from "@trail/contracts/transport";
import { SegmentedControl } from "../ui/SegmentedControl";
import "./LevelControl.css";

/** The levels by the names the control gives them. */
export const levelLabels: Readonly<Record<ProcessingLevel, string>> = {
  raw: "Raw",
  averaged: "Averaged",
  mapped: "Mapped",
  inferred: "Transport",
};

const options = processingLevels.map((value) => ({ value, label: levelLabels[value] }));

const explanations: Readonly<Record<ProcessingLevel, string>> = {
  raw: "The points as the phone sent them.",
  averaged: "Outliers dropped and GPS noise smoothed.",
  mapped: "Snapped to roads and railways.",
  inferred: "Stops and moves, coloured by how you travelled.",
};

interface LevelControlProps {
  level: ProcessingLevel;
  /** What the tracks shown reached; null while they load. */
  available: ProcessingLevel | null;
  onChange: (level: ProcessingLevel) => void;
}

/** Raw · Averaged · Mapped · Transport, with a word on what the map shows and what it lacks. */
export function LevelControl({ level, available, onChange }: LevelControlProps) {
  const short =
    available === null || available === level
      ? null
      : available === "raw"
        ? "Some points have not been processed yet: they are shown as recorded."
        : "Map data is not there for all of it yet: some lines are averaged.";
  return (
    <div className="level-control">
      <SegmentedControl
        label="Detail of the tracks"
        value={level}
        options={options}
        onChange={onChange}
      />
      <p className="level-control__note" role="status">
        {explanations[level]}
        {short === null ? null : <span className="level-control__short"> {short}</span>}
      </p>
    </div>
  );
}
