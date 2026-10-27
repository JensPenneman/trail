import { type TransportMode, toggleEndingStopS } from "@trail/contracts/transport";
import { type SQL, sql } from "drizzle-orm";

/**
 * The kinds of travel the splitting stage cuts between (docs/architecture.md
 * §17.3): on foot, on a bike, or in a vehicle. Changing between vehicles needs
 * a transfer, so a bus that looks like a car between its stops is no change.
 */
export type TravelFamily = "foot" | "cycle" | "vehicle";

const onFoot: readonly TransportMode[] = ["walking", "running"];
const byBike: readonly TransportMode[] = ["cycling"];
/** No kind of travel: not moving, or not known. */
const none: readonly TransportMode[] = ["stationary", "unknown"];

export function familyOf(mode: TransportMode): TravelFamily | null {
  if (onFoot.includes(mode)) return "foot";
  if (byBike.includes(mode)) return "cycle";
  if (none.includes(mode)) return null;
  return "vehicle";
}

const list = (modes: readonly TransportMode[]) =>
  sql.raw(modes.map((mode) => `'${mode}'`).join(", "));

/** `familyOf` in SQL, of a mode column (null for none). */
function familySql(mode: SQL): SQL {
  return sql`(CASE WHEN ${mode} IN (${list(onFoot)}) THEN 'foot'
    WHEN ${mode} IN (${list(byBike)}) THEN 'cycle'
    WHEN ${mode} IS NULL OR ${mode} IN (${list(none)}) THEN NULL
    ELSE 'vehicle' END)`;
}

/**
 * Whether stored segment `segment` (an alias of `segments`) ends quick toggle
 * `toggle` (an alias of `mode_overrides`) when it starts after the toggle
 * began (docs/architecture.md §17.5): a stop of `toggleEndingStopS` or more,
 * or a move the inference reads as another kind of travel than the toggle's.
 */
export function endsToggleSql(segment: string, toggle: string): SQL {
  const s = sql.raw(segment);
  const o = sql.raw(toggle);
  return sql`((${s}.kind = 'stop'
      AND ${s}.ended_at - ${s}.started_at >= make_interval(secs => ${toggleEndingStopS}))
    OR (${s}.kind = 'move'
      AND ${familySql(sql`${s}.mode_inferred`)} <> ${familySql(sql`${o}.mode`)}))`;
}
