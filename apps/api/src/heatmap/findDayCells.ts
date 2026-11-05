import type { TransportMode } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { HeatCells } from "./findHeatCells";
import { viewCells } from "./heatCellCap";
import { heatDayLevelFor } from "./heatDayLevels";

interface CellRow extends Record<string, unknown> {
  cell_x: number;
  cell_y: number;
  value: string | number;
}

/** A speed has to rest on at least this many seconds on the move in a cell to be told. */
const minSpeedSeconds = 10;

/**
 * The cells of time on the move, average speed and top speed over a period (docs/architecture.md
 * §8.2) from `heat_days`: whole cells, the stored level the first of 12, 15, 18 that is as fine as
 * the cell zoom (finer zooms are answered at 18, `cellZoom` says which), summed over the devices
 * and days, of one mode or every one. Time on the move adds the devices' times; the average speed
 * is time-weighted (`speed_s` over `move_s`) and told in cm/s from `minSpeedSeconds` of it; the
 * top speed is the fastest in the cell, in cm/s. Busiest first, `limit` of them.
 */
export async function findDayCells(
  db: Executor,
  input: {
    deviceIds: readonly string[];
    heat: "moving" | "speed" | "topspeed";
    mode: TransportMode | null;
    bbox: readonly [number, number, number, number];
    cellZoom: number;
    from: string;
    to: string;
    limit: number;
  },
): Promise<HeatCells> {
  const { stored, cellZoom } = heatDayLevelFor(input.cellZoom);
  if (input.deviceIds.length === 0) return { cellZoom, cells: [], truncated: false };
  const area = viewCells(input.bbox, cellZoom);
  const shift = stored - cellZoom;
  const [yMin, yMax] = area.rows;
  const [xFrom, xTo] = area.columns;
  const rows = [yMin * 2 ** shift, (yMax + 1) * 2 ** shift - 1];
  const from = xFrom * 2 ** shift;
  const to = (xTo + 1) * 2 ** shift - 1;
  const columns = area.wraps ? sql`(x >= ${from} OR x <= ${to})` : sql`x BETWEEN ${from} AND ${to}`;
  const value =
    input.heat === "moving"
      ? sql`sum(move_s)`
      : input.heat === "speed"
        ? sql`round(100 * sum(speed_s) / nullif(sum(move_s), 0))`
        : sql`round(100 * max(max_speed))`;
  const having =
    input.heat === "speed"
      ? sql`sum(move_s) >= ${minSpeedSeconds} AND round(100 * sum(speed_s) / nullif(sum(move_s), 0)) > 0`
      : input.heat === "topspeed"
        ? sql`round(100 * max(max_speed)) > 0`
        : sql`sum(move_s) > 0`;
  const result = await db.execute<CellRow>(sql`
    SELECT x >> ${shift}::int AS cell_x, y >> ${shift}::int AS cell_y, ${value} AS value
    FROM heat_days
    WHERE device_id = ANY(${sql.param(input.deviceIds)}::uuid[]) AND z = ${stored}
      AND y BETWEEN ${rows[0]} AND ${rows[1]} AND ${columns}
      AND day BETWEEN ${input.from}::date AND ${input.to}::date
      ${input.mode === null ? sql`` : sql`AND mode = ${input.mode}`}
    GROUP BY cell_x, cell_y
    HAVING ${having}
    ORDER BY value DESC, cell_x, cell_y
    LIMIT ${input.limit + 1}
  `);
  return {
    cellZoom,
    cells: result.rows
      .slice(0, input.limit)
      .map((row) => [row.cell_x, row.cell_y, Number(row.value)] as [number, number, number]),
    truncated: result.rows.length > input.limit,
  };
}
