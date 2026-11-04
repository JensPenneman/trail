import type { PathLegendModel } from "../map/pathColour/pathLegend";
import { MapKey } from "../pages/map/MapKey";

interface PathKeyProps {
  legend: PathLegendModel;
  /** The id the map's canvas points `aria-describedby` at. */
  id: string;
}

/** The speed (or pace) key over the map's bottom-left corner: five steps, slower to faster. */
export function PathKey({ legend, id }: PathKeyProps) {
  if (legend.key === null) return null;
  return (
    <MapKey
      id={id}
      title={legend.key.title}
      items={legend.key.steps}
      {...(legend.key.ends === undefined ? {} : { ends: legend.key.ends })}
    />
  );
}
