import type { InsightsModeShare } from "@trail/contracts/insights";
import { useId } from "react";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { ModeSwatch } from "../../transport/ModeSwatch";
import { transportModeInfo } from "../../transport/transportModes";
import { useScrollableFocus } from "../../ui/useScrollableFocus";
import { formatKmh } from "./insightsFormat";
import { insightsLink } from "./insightsSearch";
import "./ModeTable.css";

interface ModeTableProps {
  modes: readonly InsightsModeShare[];
  params: URLSearchParams;
  /** "the 30 days before", or null when there is nothing to compare with. */
  compared: string | null;
}

/** Every mode of the period with its numbers; each opens its own page. */
export function ModeTable({ modes, params, compared }: ModeTableProps) {
  const format = useFormatter();
  const captionId = useId();
  const scrollable = useScrollableFocus();
  const signed = (metres: number) =>
    Math.round(metres) === 0
      ? "±0"
      : `${metres > 0 ? "+" : "−"}${format.distance(Math.abs(metres))}`;
  return (
    <section
      className="table-scroll card card--flush mode-table"
      aria-labelledby={captionId}
      ref={scrollable}
    >
      <table className="table">
        <caption id={captionId} className="visually-hidden">
          Modes of the period
        </caption>
        <thead>
          <tr>
            <th scope="col">Mode</th>
            <th scope="col" className="table__number">
              Distance
            </th>
            <th scope="col" className="table__number">
              Time
            </th>
            <th scope="col" className="table__number">
              Moves
            </th>
            <th scope="col" className="table__number">
              Average speed
            </th>
            <th scope="col" className="table__number">
              Share
            </th>
            {compared === null ? null : (
              <th scope="col" className="table__number">
                Against {compared}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {modes.map((row) => (
            <tr key={row.mode}>
              <th scope="row">
                <Link
                  className="mode-table__mode"
                  to={insightsLink(`/insights/transport/${row.mode}`, params)}
                >
                  <ModeSwatch mode={row.mode} />
                  {transportModeInfo[row.mode].label}
                </Link>
              </th>
              <td className="table__number">{format.distance(row.distanceM)}</td>
              <td className="table__number">{format.duration(row.durationS)}</td>
              <td className="table__number">{format.count(row.moves)}</td>
              <td className="table__number">{formatKmh(format, row.avgSpeedKmh)}</td>
              <td className="table__number">{format.percent(row.share)}</td>
              {compared === null ? null : (
                <td className="table__number">{signed(row.deltaDistanceM)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
