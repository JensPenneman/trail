import type { InsightsMode } from "@trail/contracts/insights";
import { Histogram } from "../../charts/Histogram";
import { describeExtremes } from "../../charts/summaries";
import { useFormatter } from "../../format/useFormatter";

/** The moves by how fast they mostly went (their median speed). */
export function SpeedHistogram({ insights }: { insights: InsightsMode }) {
  const format = useFormatter();
  const number = new Intl.NumberFormat(format.locale, { maximumFractionDigits: 0 });
  const bins = insights.speedHistogram.bins.map((bin) => ({
    from: bin.fromKmh,
    to: bin.toKmh,
    count: bin.moves,
  }));
  const formatBin = (from: number, to: number) =>
    `${number.format(from)}–${number.format(to)} km/h`;
  const formatCount = (count: number) => `${format.count(count)} ${count === 1 ? "move" : "moves"}`;
  return (
    <Histogram
      title="Moves by speed"
      summary={describeExtremes(
        bins.map((bin) => ({ label: formatBin(bin.from, bin.to), value: bin.count })),
        formatCount,
      )}
      bins={bins}
      tone={insights.mode}
      formatEdge={(edge) => number.format(edge)}
      formatBin={formatBin}
      formatCount={formatCount}
      xLabel="Median speed, km/h"
      countLabel="Moves"
    />
  );
}
