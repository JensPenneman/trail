import { type SQL, sql } from "drizzle-orm";
import { mercatorMaxLatitude } from "./heatCellLevels";

const maxLatitude = sql.raw(String(mercatorMaxLatitude));

/**
 * The tile column of a longitude at zoom `z`, as SQL: the expression `heatCellsUpsert` stores cells
 * with and `findStopCells` groups stays by, one definition (the same as `tileMath.lonToTileX`;
 * `heatStops.test.ts` guards the three against each other). `lon` and `z` are SQL expressions.
 */
export function tileXSql(lon: SQL, z: SQL): SQL {
  return sql`least(greatest(floor((${lon} + 180.0) / 360.0 * (1 << ${z}))::int, 0), (1 << ${z}) - 1)`;
}

/** The tile row of a latitude (clamped to Web Mercator's) at zoom `z`, as SQL. */
export function tileYSql(lat: SQL, z: SQL): SQL {
  const clamped = sql`least(greatest(${lat}, -${maxLatitude}), ${maxLatitude})`;
  return sql`least(
    greatest(
      floor((1.0 - ln(tan(radians(${clamped})) + 1.0 / cos(radians(${clamped}))) / pi()) / 2.0 * (1 << ${z}))::int,
      0
    ),
    (1 << ${z}) - 1
  )`;
}
