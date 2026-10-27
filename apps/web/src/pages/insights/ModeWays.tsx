import type { InsightsMode } from "@trail/contracts/insights";
import { useId } from "react";
import { StatTile } from "../../charts/StatTile";
import { StatTiles } from "../../charts/StatTiles";
import { useFormatter } from "../../format/useFormatter";
import { Notice } from "../../ui/Notice";
import { railModes, roadModes } from "./roadModes";
import { WayKindBars } from "./WayKindBars";

/** How much of a distance the map data covers, in words; null when all of it. */
function coverage(mappedM: number, distanceM: number, percent: (share: number) => string) {
  if (distanceM <= 0 || mappedM >= distanceM * 0.995) return null;
  return `Map data covers ${percent(mappedM / distanceM)} of this distance; the rest is not counted here.`;
}

/**
 * Where this mode went, by kind of way: road classes for walking, running,
 * cycling, cars and buses; the share on track and the halts at stations for
 * trains, trams and metros; the share on ferry routes for boats. Nothing for
 * other modes.
 */
export function ModeWays({ insights }: { insights: InsightsMode }) {
  const format = useFormatter();
  const headingId = useId();
  const { mode, roads } = insights;
  const road = roadModes.has(mode);
  const rail = railModes.has(mode);
  if (!road && !rail && mode !== "boat") return null;
  const covered = coverage(roads.mappedM, roads.distanceM, format.percent);
  const noMap = roads.distanceM > 0 && roads.mappedM <= 0;
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <h2 className="section__title" id={headingId}>
          {road ? "Roads" : rail ? "On the rails" : "On the water"}
        </h2>
      </div>
      {roads.distanceM <= 0 ? (
        <p className="muted">No moves in this period.</p>
      ) : noMap ? (
        <Notice tone="info" title="No map data for these moves">
          <p>
            Trail lays moves onto OpenStreetMap's roads and railways once it has the map of their
            area. It may still be fetching it, or the server works without map data.
          </p>
        </Notice>
      ) : (
        <>
          {rail && insights.rail !== null ? (
            <StatTiles label="On the rails">
              <StatTile label="On railway track" value={format.percent(insights.rail.share)} />
              <StatTile
                label={mode === "tram" ? "Halts at tram stops" : "Halts at stations"}
                value={format.count(insights.stationStops ?? 0)}
                {...(insights.totals.moves > 0
                  ? {
                      detail: `${new Intl.NumberFormat(format.locale, { maximumFractionDigits: 1 }).format((insights.stationStops ?? 0) / insights.totals.moves)} a ride`,
                    }
                  : {})}
              />
            </StatTiles>
          ) : null}
          {mode === "boat" && insights.ferry !== null ? (
            <StatTiles label="On the water">
              <StatTile label="On ferry routes" value={format.percent(insights.ferry.share)} />
            </StatTiles>
          ) : null}
          {road ? (
            <WayKindBars title="Distance by kind of road" kinds={roads.kinds} tone={mode} />
          ) : null}
          {covered === null ? null : <p className="muted">{covered}</p>}
        </>
      )}
    </section>
  );
}
