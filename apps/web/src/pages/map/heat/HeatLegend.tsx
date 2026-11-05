import type { HeatMeasure } from "@trail/contracts/heatmap";
import type { ReactNode } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { heatRamp } from "../../../map/heatRamp";
import { type HeatScale, heatShadeOf } from "../../../map/heatScale";
import { MapKey } from "../MapKey";
import { classLabels, heatMeasureInfo } from "./heatMeasures";

interface HeatLegendProps {
  /** The element id the map's canvas describes itself by. */
  id: string;
  /** What the answer on screen counts (its own, not the one asked for). */
  heat: HeatMeasure;
  /** The scale the map colours its squares with now; null while the answer is on its way. */
  scale: HeatScale | null;
  /** What the answer covers, in words: "All time", "Since 4 Nov 2023", "1–31 Oct 2026". */
  detail: string | null;
  /** Whether the map is dark (dark or satellite): the swatches are the colours drawn on it. */
  dark: boolean;
  /** What to say when there are no classes: loading, or nothing in view. */
  status: string | null;
  /** The answer is incomplete (cut at the ceiling) or recent days are still being worked out. */
  truncated: boolean;
  pending: boolean;
  /** A way to ask again, when the answer could not be loaded. */
  retry?: ReactNode;
}

/**
 * The key of the heatmap: every colour on the map with what it stands for, from least to most,
 * for the measure on screen and its period. The ends are a visual cue; the classes say it in words.
 */
export function HeatLegend({
  id,
  heat,
  scale,
  detail,
  dark,
  status,
  truncated,
  pending,
  retry,
}: HeatLegendProps) {
  const format = useFormatter();
  const info = heatMeasureInfo[heat];
  const ramp = dark ? heatRamp.dark : heatRamp.light;
  const classes = scale?.starts.length ?? 0;
  const labels = scale === null ? [] : classLabels(heat, scale.starts, format);
  return (
    <MapKey
      id={id}
      title={info.title}
      detail={detail}
      items={
        classes === 0
          ? null
          : labels.map((label, index) => ({
              label,
              color: ramp[heatShadeOf(index, classes) - 1] ?? "",
            }))
      }
      ends={info.ends}
      status={status}
      notes={[
        ...(truncated ? ["Busiest places only: zoom in to see every place"] : []),
        ...(pending ? ["Recent days are still being worked out"] : []),
        ...(retry === null || retry === undefined ? [] : [retry]),
      ]}
    />
  );
}
