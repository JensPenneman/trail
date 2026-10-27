import { texturePatterns } from "./textures";
import "./TexturePattern.css";

/** The forced-colours texture of the series at `index`, for `fill: url(#id)`; the solid first series needs none. */
export function TexturePattern({ id, index }: { id: string; index: number }) {
  const pattern = texturePatterns[index % texturePatterns.length];
  if (pattern === null || pattern === undefined) return null;
  const { size } = pattern;
  const half = size / 2;
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={size}
      height={size}
      patternTransform={`rotate(${pattern.angle})`}
    >
      <rect className="chart-texture__ground" width={size} height={size} />
      {pattern.kind === "dots" ? (
        <circle className="chart-texture__dot" cx={half} cy={half} r={1.2} />
      ) : (
        <path
          className="chart-texture__ink"
          d={
            pattern.kind === "cross" ? `M${half} 0V${size}M0 ${half}H${size}` : `M${half} 0V${size}`
          }
        />
      )}
    </pattern>
  );
}
