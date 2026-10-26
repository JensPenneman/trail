import { asc, eq, sql } from "drizzle-orm";
import { devices } from "../../db/schema/devices";
import { toIso } from "../../db/toIso";
import { isUuid } from "../../lib/isUuid";
import { processingConfigWith } from "../../processing/processingConfig";
import { enqueueWindow, type FromLevel, takeDeviceWindows } from "../../processing/processingQueue";
import { processWindow } from "../../processing/processWindow";
import type { CliContext } from "../cliContext";
import { UsageError } from "../usageError";

const dayMs = 86_400_000;
const levels: readonly FromLevel[] = ["averaged", "mapped", "inferred"];

export interface ReprocessOptions {
  device: string | undefined;
  from: string | undefined;
  to: string | undefined;
  fromLevel: string | undefined;
}

function instant(name: string, value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new UsageError(`--${name} must be an ISO 8601 time such as 2026-10-01T00:00:00Z`);
  }
  return date;
}

/** Checks the options before any database work. */
export function parseReprocessOptions(options: ReprocessOptions): {
  device: string | undefined;
  range: { from: Date; to: Date } | null;
  fromLevel: FromLevel;
} {
  if (options.device !== undefined && !isUuid(options.device)) {
    throw new UsageError("--device must be a device id (a UUID, shown in the device's URL)");
  }
  if ((options.from === undefined) !== (options.to === undefined)) {
    throw new UsageError("--from and --to go together");
  }
  const range =
    options.from === undefined || options.to === undefined
      ? null
      : { from: instant("from", options.from), to: instant("to", options.to) };
  if (range !== null && range.to <= range.from) throw new UsageError("--to must be after --from");
  const fromLevel = (options.fromLevel ?? "averaged") as FromLevel;
  if (!levels.includes(fromLevel)) {
    throw new UsageError("--from-level must be averaged, mapped or inferred");
  }
  return { device: options.device, range, fromLevel };
}

/**
 * `trail reprocess` — works out the processed levels again (docs/architecture.md
 * §17.4): the whole history, one device, or a range, from averaging on (the
 * default), from map matching on, or only the inference. The windows are
 * queued first, a day each, so an interrupted run leaves the rest to the
 * server; then they are processed here with the map data already cached.
 * Tiles still missing are left to the server, which fetches them politely.
 */
export async function reprocessCommand(ctx: CliContext, options: ReprocessOptions): Promise<void> {
  const parsed = parseReprocessOptions(options);
  const settings = ctx.config.processing;
  if (!settings.enabled) {
    throw new Error("processing is switched off (PROCESSING_ENABLED=false)");
  }
  const config = processingConfigWith(settings);
  const query = ctx.db.select({ id: devices.id, name: devices.name }).from(devices);
  const targets = await (parsed.device === undefined
    ? query.orderBy(asc(devices.createdAt))
    : query.where(eq(devices.id, parsed.device)));
  if (targets.length === 0) {
    if (parsed.device !== undefined) throw new Error(`No device with id ${parsed.device}`);
    console.log("No devices yet: nothing to reprocess.");
    return;
  }
  for (const device of targets) {
    let range = parsed.range;
    if (range === null) {
      const span = await ctx.db.execute<{ first: string | null; last: string | null }>(sql`
        SELECT min(recorded_at)::text AS first, max(recorded_at)::text AS last
        FROM locations WHERE device_id = ${device.id}
      `);
      const first = span.rows[0]?.first ?? null;
      const last = span.rows[0]?.last ?? null;
      if (first === null || last === null) {
        console.log(`${device.name} (${device.id}): no points`);
        continue;
      }
      range = { from: new Date(toIso(first)), to: new Date(Date.parse(toIso(last)) + 1000) };
    }
    for (let start = range.from.getTime(); start < range.to.getTime(); start += dayMs) {
      await enqueueWindow(ctx.db, {
        deviceId: device.id,
        from: new Date(start),
        to: new Date(Math.min(start + dayMs, range.to.getTime())),
        reason: "reprocess",
        fromLevel: parsed.fromLevel,
      });
    }
    let windows = 0;
    let points = 0;
    let segments = 0;
    const missing = new Set<string>();
    for (;;) {
      const rows = await takeDeviceWindows(ctx.db, device.id, range.from, range.to);
      if (rows.length === 0) break;
      const outcome = await processWindow(ctx.db, rows, {
        config,
        mapping: settings.overpassUrl !== null,
        now: new Date(),
      });
      if (outcome === null) break;
      windows += 1;
      points += outcome.points;
      segments += outcome.segments;
      for (const tile of outcome.missingTiles) missing.add(tile);
    }
    const waiting =
      missing.size === 0 ? "" : `; waiting for ${missing.size} map tiles, which the server fetches`;
    console.log(
      `${device.name} (${device.id}): ${windows} windows, ${points} points, ${segments} stops and moves${waiting}`,
    );
  }
}
