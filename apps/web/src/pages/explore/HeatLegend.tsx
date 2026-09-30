import "./HeatLegend.css";

/** Key for the heatmap's single-hue ramp. */
export function HeatLegend() {
  return (
    <div className="heat-legend">
      <span className="heat-legend__ramp" aria-hidden="true" />
      <div className="heat-legend__labels">
        <span>Fewer points</span>
        <span>More points</span>
      </div>
    </div>
  );
}
