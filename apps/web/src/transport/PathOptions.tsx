import type { PathColour } from "@trail/contracts/preferences";
import { pathColourLabels } from "../map/pathColour/pathColours";
import type { PathLegendModel } from "../map/pathColour/pathLegend";
import { SelectField } from "../ui/SelectField";
import { type LegendDevice, PathLegend } from "./PathLegend";

interface PathOptionsProps {
  colour: PathColour;
  options: readonly PathColour[];
  onChange: (colour: PathColour) => void;
  legend: PathLegendModel;
  /** The own devices and the people drawn: "Device" reads "Device or person" with someone else's track on. */
  devices: readonly LegendDevice[];
}

/**
 * What the lines are coloured by, and the map legend of that (docs/architecture.md §14): the
 * options the level supports, the classes of the one chosen. Someone else's track keeps its
 * person colour under every one, which "Device or person" says when it is drawn.
 */
export function PathOptions({ colour, options, onChange, legend, devices }: PathOptionsProps) {
  const people = devices.some(
    (device) => device.palette === "person" && legend.deviceIds.includes(device.id),
  );
  return (
    <div className="path-options">
      <SelectField
        label="Colour by"
        value={colour}
        onChange={(event) => onChange(event.currentTarget.value as PathColour)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "device" && people ? "Device or person" : pathColourLabels[option]}
          </option>
        ))}
      </SelectField>
      <PathLegend legend={legend} devices={devices} />
    </div>
  );
}
