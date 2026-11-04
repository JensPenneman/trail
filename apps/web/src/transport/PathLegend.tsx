import { useId } from "react";
import type { PathLegendModel } from "../map/pathColour/pathLegend";
import { DeviceSwatch } from "../ui/DeviceSwatch";
import { PlainList } from "../ui/PlainList";
import { ModeLegend } from "./ModeLegend";
import { ModeSwatch } from "./ModeSwatch";
import "./ModeLegend.css";
import "./PathLegend.css";

/** A drawn device or person: its name and the palette slot of its colour. */
export interface LegendDevice {
  id: string;
  name: string;
  slot: number;
  palette: "device" | "person";
}

interface PathLegendProps {
  legend: PathLegendModel;
  /** The own devices and the people drawn, for the device colouring. */
  devices: readonly LegendDevice[];
}

/**
 * The map legend of Map options: what each colour is, for the colourings that have classes — the
 * modes, the devices and people, the times of day — and the line styles the map draws over them
 * (a move to review, the path within a stop, a gap in the recording). A speed is told by the key
 * over the map instead.
 */
export function PathLegend({ legend, devices }: PathLegendProps) {
  const headingId = useId();
  const { review, stopPaths, gaps } = legend.lineStyles;
  if (legend.by === "mode") {
    return <ModeLegend modes={legend.modes} review={review} stopPaths={stopPaths} gaps={gaps} />;
  }
  const drawn = devices.filter((device) => legend.deviceIds.includes(device.id));
  const hasClasses = legend.by === "time" || (legend.by === "device" && drawn.length > 0);
  if (!hasClasses && !review && !stopPaths && !gaps) return null;
  return (
    <section className="mode-legend" aria-labelledby={headingId}>
      <h2 className="visually-hidden" id={headingId}>
        Map legend
      </h2>
      <PlainList className="mode-legend__list">
        {legend.by === "device"
          ? drawn.map((device) => (
              <li key={device.id} className="mode-legend__item">
                <DeviceSwatch slot={device.slot} shape="line" palette={device.palette} />
                {device.name}
              </li>
            ))
          : null}
        {legend.by === "time"
          ? legend.classes.map((item) => (
              <li key={item.label} className="mode-legend__item">
                <span
                  className="path-legend__swatch"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                {item.label}
              </li>
            ))
          : null}
        {review ? (
          <li className="mode-legend__item">
            <ModeSwatch mode="unknown" dashed />
            Unsure: worth a look
          </li>
        ) : null}
        {stopPaths ? (
          <li className="mode-legend__item">
            <ModeSwatch mode="stationary" dotted />
            Moved within a stop
          </li>
        ) : null}
        {gaps ? (
          <li className="mode-legend__item">
            <ModeSwatch mode="unknown" gap />
            No data: a gap in the recording
          </li>
        ) : null}
      </PlainList>
    </section>
  );
}
