import { getDaySummaryInputSchema, getDaySummaryOutputSchema } from "@trail/contracts/mcp";
import { sql } from "drizzle-orm";
import type { Executor } from "../../db/database";
import { toIso } from "../../db/toIso";
import { loadModeStats } from "../../transport/loadModeStats";
import { loadTimeline } from "../../transport/loadTimeline";
import { chooseDevice } from "../chooseDevice";
import { defineTool } from "../defineTool";
import { deviceRef, quoted } from "../deviceRef";
import { ownAccess } from "../toolAccess";
import { formatInZone } from "../zonedTime";

/** Where a local day starts and ends, as Postgres works it out (daylight saving time included). */
async function dayBounds(
  db: Executor,
  date: string,
  timeZone: string,
): Promise<{ start: Date; end: Date }> {
  const result = await db.execute<{ day_start: string; day_end: string }>(sql`
    SELECT ((${date}::date)::timestamp AT TIME ZONE ${timeZone})::text AS day_start,
      ((${date}::date + 1)::timestamp AT TIME ZONE ${timeZone})::text AS day_end
  `);
  const [row] = result.rows;
  if (row === undefined) throw new Error("The day's bounds could not be worked out");
  return { start: new Date(toIso(row.day_start)), end: new Date(toIso(row.day_end)) };
}

/**
 * `get_day_summary` — distance and time per mode, stops and the first and last
 * movement of one local day: the history without coordinates (`history:read`).
 * It reads the timeline, but only times and counts leave it — no stop, no
 * place, nothing a position could be worked out from.
 */
export const getDaySummary = defineTool({
  name: "get_day_summary",
  title: "Summarise a day",
  description:
    "One device's day in figures, without places: distance and time per transport mode (stationary is time at stops), the number of stops and moves, the total distance and moving time, and when the first move started and the last one ended. `date` is a calendar day in the account's time zone. Without `device`, the device that reported a position most recently.",
  scopes: ["history:read"],
  input: getDaySummaryInputSchema,
  output: getDaySummaryOutputSchema,
  access: "read",
  async run(input, context) {
    const { timeZone } = context;
    const summary = await chooseDevice(context.db, context.principal, input.device);
    const device = deviceRef(summary);
    const stats = await loadModeStats(context.db, context.principal, {
      devices: [summary.id],
      from: input.date,
      to: input.date,
    });
    const bounds = await dayBounds(context.db, input.date, timeZone);
    // A day holds far fewer segments than a page; only their kinds and times are read.
    const timeline = await loadTimeline(context.db, context.principal, {
      devices: [summary.id],
      from: bounds.start,
      to: bounds.end,
      limit: 1000,
    });
    const modes = stats.days
      .filter((stat) => stat.date === input.date)
      .map((stat) => ({
        mode: stat.mode,
        distanceM: Math.round(stat.distanceM),
        durationS: Math.round(stat.durationS),
        segments: stat.segments,
      }));
    const moves = timeline.items.filter((segment) => segment.kind === "move");
    const stops = timeline.items.length - moves.length;
    const moving = modes.filter((mode) => mode.mode !== "stationary");
    const firstMove = moves[0];
    const lastMove = moves.at(-1);
    const clamp = (instant: string) =>
      new Date(
        Math.min(Math.max(Date.parse(instant), bounds.start.getTime()), bounds.end.getTime()),
      );
    const result = {
      device,
      date: input.date,
      timeZone,
      modes,
      stops,
      moves: moves.length,
      distanceM: moving.reduce((total, mode) => total + mode.distanceM, 0),
      movingS: moving.reduce((total, mode) => total + mode.durationS, 0),
      firstMovementAt:
        firstMove === undefined ? null : formatInZone(clamp(firstMove.startedAt), timeZone),
      lastMovementAt:
        lastMove === undefined ? null : formatInZone(clamp(lastMove.endedAt), timeZone),
      pending: timeline.pending,
    };
    const travelled = (result.distanceM / 1000).toFixed(1);
    return {
      result,
      text: `${quoted(device.name)} on ${input.date}: ${result.moves} move${result.moves === 1 ? "" : "s"} over ${travelled} km and ${stops} stop${stops === 1 ? "" : "s"}.${
        result.pending ? " Some points still wait to be processed." : ""
      }`,
      items: modes.length,
      access: ownAccess([summary], { date: input.date }),
    };
  },
});
