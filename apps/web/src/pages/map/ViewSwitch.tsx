import { SegmentedControl } from "../../ui/SegmentedControl";
import type { MapView } from "./mapViews";

const labels: Readonly<Record<MapView, string>> = {
  live: "Live",
  history: "History",
  heat: "Heat",
};

/** Live · History · Heat (the views there are, see viewsFor): what the one map of the page shows. */
export function ViewSwitch({
  view,
  views,
  onChange,
}: {
  view: MapView;
  views: readonly MapView[];
  onChange: (view: MapView) => void;
}) {
  return (
    <div className="view-switch">
      <SegmentedControl
        label="Map view"
        value={view}
        options={views.map((value) => ({ value, label: labels[value] }))}
        onChange={onChange}
      />
    </div>
  );
}
