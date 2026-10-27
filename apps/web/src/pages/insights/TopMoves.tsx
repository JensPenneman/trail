import type { InsightsMode, InsightsMove } from "@trail/contracts/insights";
import { useId, useState } from "react";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { localDateOf } from "../../time/localDateOf";
import { Icon } from "../../ui/Icon";
import { PlainList } from "../../ui/PlainList";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { formatKmh } from "./insightsFormat";
import "./TopMoves.css";

type List = "longest" | "fastest" | "recent";

/** The History view of the move's day with the move's details open. */
export const moveOnMap = (move: InsightsMove, timeZone: string): string =>
  `/?${new URLSearchParams({
    view: "history",
    date: localDateOf(move.startedAt, timeZone),
    segment: move.segmentId,
  }).toString()}`;

/** The moves worth a look — the longest, the fastest, the latest — each a link to the map. */
export function TopMoves({ insights }: { insights: InsightsMode }) {
  const format = useFormatter();
  const headingId = useId();
  const [list, setList] = useState<List>("longest");
  const moves = insights.topMoves[list];
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          Top moves
        </h2>
        <SegmentedControl
          label="Which moves"
          value={list}
          options={[
            { value: "longest", label: "Longest" },
            { value: "fastest", label: "Fastest" },
            { value: "recent", label: "Latest" },
          ]}
          onChange={setList}
        />
      </div>
      {moves.length === 0 ? (
        <p className="muted">No moves in this period.</p>
      ) : (
        <PlainList className="card card--flush top-moves">
          {moves.map((move) => {
            const when = format.dayTime(move.startedAt);
            return (
              <li key={move.segmentId} className="top-move">
                <p className="top-move__when">{when}</p>
                <p className="top-move__facts">
                  <span>{format.distance(move.distanceM)}</span>
                  <span>{format.duration(move.durationS)}</span>
                  <span>{formatKmh(format, move.avgSpeedKmh)} average</span>
                  <span>{formatKmh(format, move.maxSpeedKmh)} top</span>
                </p>
                <Link className="top-move__link" to={moveOnMap(move, insights.timezone)}>
                  <Icon name="map" />
                  <span>
                    Show on the map<span className="visually-hidden">: {when}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </PlainList>
      )}
    </section>
  );
}
