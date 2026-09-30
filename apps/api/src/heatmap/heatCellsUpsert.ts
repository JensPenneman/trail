import { type SQL, sql } from "drizzle-orm";
import { heatCellMaxAccuracy, heatCellZooms, mercatorMaxLatitude } from "./heatCellLevels";

const zoomValues = sql.raw(heatCellZooms.map((zoom) => `(${zoom})`).join(", "));
const maxLatitude = sql.raw(String(mercatorMaxLatitude));

/**
 * `INSERT INTO heat_cells … ON CONFLICT DO UPDATE` adding the points of
 * `source` (a relation with recorded_at, lat, lon, horizontal_accuracy) to a
 * device's cells at every level. The tile maths matches `tileMath.ts`.
 */
export function heatCellsUpsert(deviceId: string, source: SQL): SQL {
  return sql`
    INSERT INTO heat_cells AS h (device_id, z, x, y, count, first_at, last_at)
    SELECT ${deviceId}::uuid, t.z, t.x, t.y, count(*)::int, min(t.recorded_at), max(t.recorded_at)
    FROM (
      SELECT zl.z, p.recorded_at,
        least(greatest(floor((p.lon + 180.0) / 360.0 * (1 << zl.z))::int, 0), (1 << zl.z) - 1) AS x,
        least(
          greatest(
            floor((1.0 - ln(tan(radians(c.lat)) + 1.0 / cos(radians(c.lat))) / pi()) / 2.0 * (1 << zl.z))::int,
            0
          ),
          (1 << zl.z) - 1
        ) AS y
      FROM ${source} AS p
      CROSS JOIN LATERAL (
        SELECT least(greatest(p.lat, -${maxLatitude}), ${maxLatitude}) AS lat
      ) AS c
      CROSS JOIN (VALUES ${zoomValues}) AS zl(z)
      WHERE p.horizontal_accuracy IS NULL OR p.horizontal_accuracy <= ${heatCellMaxAccuracy}
    ) AS t
    GROUP BY t.z, t.x, t.y
    ON CONFLICT (device_id, z, x, y) DO UPDATE SET
      count = h.count + excluded.count,
      first_at = least(h.first_at, excluded.first_at),
      last_at = greatest(h.last_at, excluded.last_at)
  `;
}
