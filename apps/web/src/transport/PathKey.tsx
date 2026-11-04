import { useId } from "react";
import type { PathLegendModel } from "../map/pathColour/pathLegend";
import { MapKey } from "../pages/map/MapKey";

interface PathKeyProps {
  legend: PathLegendModel;
}

/** The speed (or pace) key over the map's bottom-left corner: five steps, slower to faster. */
export function PathKey({ legend }: PathKeyProps) {
  const id = useId();
  if (legend.key === null) return null;
  return (
    <MapKey id={id} title={legend.key.title} items={legend.key.steps} ends={legend.key.ends} />
  );
}
