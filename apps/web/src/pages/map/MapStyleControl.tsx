import { type MapStyleChoice, mapStyleLabels } from "../../map/mapStyleChoices";
import { SegmentedControl } from "../../ui/SegmentedControl";
import "./MapStyleControl.css";

interface MapStyleControlProps {
  choice: MapStyleChoice;
  choices: readonly MapStyleChoice[];
  onChange: (choice: MapStyleChoice) => void;
}

/** Auto · Light · Dark · Satellite (when the server has imagery), remembered by useMapStyle. */
export function MapStyleControl({ choice, choices, onChange }: MapStyleControlProps) {
  return (
    <div className="map-style-control">
      <p className="map-options__label" aria-hidden="true">
        Map style
      </p>
      <SegmentedControl
        label="Map style"
        value={choice}
        options={choices.map((value) => ({ value, label: mapStyleLabels[value] }))}
        onChange={onChange}
      />
      {choice === "auto" ? (
        <p className="map-style-control__note">Light or dark, as the system is set.</p>
      ) : null}
    </div>
  );
}
