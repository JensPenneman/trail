import "./TrailMark.css";

interface TrailMarkProps {
  size?: number;
}

/** Past positions, older ones smaller and fainter, leading to where the device is now. */
const dots = [
  { cx: 5.5, cy: 26, r: 1.35, opacity: 0.42 },
  { cx: 9.82, cy: 24.9, r: 1.51, opacity: 0.55 },
  { cx: 12.26, cy: 21.5, r: 1.67, opacity: 0.68 },
  { cx: 14.23, cy: 17.21, r: 1.83, opacity: 0.81 },
  { cx: 16.77, cy: 13.08, r: 1.99, opacity: 0.94 },
] as const;

/** Trail's mark. Decorative: it always sits next to the word "Trail". */
export function TrailMark({ size = 28 }: TrailMarkProps) {
  return (
    <svg
      className="trail-mark"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {dots.map((dot) => (
        <circle
          key={dot.cx}
          className="trail-mark__dot"
          cx={dot.cx}
          cy={dot.cy}
          r={dot.r}
          fillOpacity={dot.opacity}
        />
      ))}
      <circle className="trail-mark__halo" cx="24" cy="8.5" r="5.4" />
      <circle className="trail-mark__head" cx="24" cy="8.5" r="3.3" />
    </svg>
  );
}
