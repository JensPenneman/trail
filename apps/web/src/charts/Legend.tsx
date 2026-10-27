import { useId } from "react";
import { PlainList } from "../ui/PlainList";
import type { ChartTone } from "./chartTypes";
import { TexturePattern } from "./TexturePattern";
import { dashStyle, textureStyle } from "./textures";
import { toneClass } from "./tones";
import "./Legend.css";

interface LegendProps {
  items: readonly { key: string; label: string; tone: ChartTone }[];
  /** The key mirrors the mark: a box for bars, a short line for lines. */
  shape: "bar" | "line";
  /** Names the list when no heading does. */
  label?: string;
}

/**
 * What the colours mean: a swatch and the series' name for each, in the
 * series' order, wrapping on narrow screens. The name is in text colour; the
 * swatch beside it carries the identity (and in forced colours the texture
 * or dash the marks wear).
 */
export function Legend({ items, shape, label }: LegendProps) {
  const prefix = `${useId()}t`;
  return (
    <PlainList className="legend" {...(label === undefined ? {} : { label })}>
      {items.map((item, index) => (
        <li key={item.key} className="legend__item">
          {shape === "bar" ? (
            <svg
              className={`legend__key ${toneClass(item.tone)}`}
              viewBox="0 0 12 12"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <TexturePattern id={`${prefix}${index}`} index={index} />
              </defs>
              <rect
                className="legend__swatch"
                width="12"
                height="12"
                rx="2"
                style={textureStyle(index, `${prefix}${index}`)}
              />
            </svg>
          ) : (
            <svg
              className={`legend__key ${toneClass(item.tone)}`}
              viewBox="0 0 20 12"
              width="20"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <line
                className="legend__line"
                x1="2"
                x2="18"
                y1="6"
                y2="6"
                style={dashStyle(index)}
              />
            </svg>
          )}
          {item.label}
        </li>
      ))}
    </PlainList>
  );
}
