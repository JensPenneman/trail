import { SegmentedControl } from "../ui/SegmentedControl";
import { type ViewerDays, viewerDays } from "./viewerDays";

/** 7 days · 30 days · 90 days. */
export function PeriodChoice({
  days,
  onChange,
}: {
  days: ViewerDays;
  onChange: (days: ViewerDays) => void;
}) {
  return (
    <SegmentedControl
      label="Period"
      value={String(days)}
      options={viewerDays.map((value) => ({ value: String(value), label: `${value} days` }))}
      onChange={(value) => onChange(Number(value) as ViewerDays)}
    />
  );
}
