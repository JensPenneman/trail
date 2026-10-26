import { SegmentedControl } from "../../ui/SegmentedControl";
import type { MapView } from "./mapViews";

const options: readonly { value: MapView; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "history", label: "History" },
  { value: "heat", label: "Heat" },
];

/** Live · History · Heat: what the one map of the page shows. */
export function ViewSwitch({
  view,
  onChange,
}: {
  view: MapView;
  onChange: (view: MapView) => void;
}) {
  return (
    <div className="view-switch">
      <SegmentedControl label="Map view" value={view} options={options} onChange={onChange} />
    </div>
  );
}
