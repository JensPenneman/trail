import "./HeatLegend.css";

/** Key for the heatmap's single-hue ramp, in the step drawn on the map's background. */
export function HeatLegend({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "heat-legend heat-legend--dark" : "heat-legend"}>
      <span className="heat-legend__ramp" aria-hidden="true" />
      <div className="heat-legend__labels">
        <span>Fewer points</span>
        <span>More points</span>
      </div>
    </div>
  );
}
