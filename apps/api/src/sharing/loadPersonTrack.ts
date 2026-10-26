import type { PersonTrackResponse, personTrackQuerySchema } from "@trail/contracts/person";
import type { Track } from "@trail/contracts/track";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { AppContext } from "../appContext";
import { notFound } from "../http/httpError";
import { buildTrack } from "../tracks/buildTrack";
import {
  grantsViewer,
  mayReadPeople,
  resolveAccessibleDevices,
  type Viewer,
} from "./accessibleDevices";
import { liveWindowMs, windowStart } from "./shareWindow";
import { touchShareViews } from "./touchShareViews";

type PersonTrackQuery = z.output<typeof personTrackQuerySchema>;

/** The server's default `maxAccuracy` of tracks: worse fixes are left out. */
const maxAccuracyM = 200;

interface GrantRow extends Record<string, unknown> {
  id: string;
  precision: string;
  history_days: number | null;
}

const emptyTrack = (deviceId: string): Track => ({
  deviceId,
  total: 0,
  returned: 0,
  simplified: false,
  distanceM: 0,
  firstAt: null,
  lastAt: null,
  points: [],
});

/**
 * Where a person has been, for a share with history (always precise): the
 * points of their shared devices in `[from, to)`, with `from` moved up to the
 * start of the shared history, so nothing older ever leaves the server. Split
 * at recording gaps and simplified like the private tracks. A person who does
 * not share with the viewer, or shares no history, is 404.
 */
export async function loadPersonTrack(
  ctx: AppContext,
  viewer: Viewer,
  userId: string,
  query: PersonTrackQuery,
): Promise<PersonTrackResponse> {
  const now = new Date();
  if (!mayReadPeople(viewer)) throw notFound("No such person.");
  const { rows } = await ctx.db.execute<GrantRow>(sql`
    SELECT s.id, s.precision, s.history_days
    FROM shares s
    WHERE ${grantsViewer(viewer.user.id, now)} AND s.owner_user_id = ${userId}
    LIMIT 1
  `);
  const [grant] = rows;
  if (grant === undefined) throw notFound("No such person.");
  if (grant.history_days === null || grant.precision !== "precise") {
    throw notFound("This person shares no history with you.");
  }

  const shared = (
    await resolveAccessibleDevices(ctx, viewer, undefined, { now, ownDevices: false })
  ).filter((device) => device.shareId === grant.id);
  let picked = shared;
  if (query.deviceIds !== undefined) {
    const wanted = new Set(query.deviceIds);
    picked = shared.filter((device) => wanted.has(device.deviceId));
    if (picked.length !== wanted.size) throw notFound("No such device.");
  }

  const historyStart = windowStart(grant.history_days, now, liveWindowMs(ctx.config));
  const to = new Date(query.to);
  const from = new Date(
    Math.min(Math.max(Date.parse(query.from), historyStart.getTime()), to.getTime()),
  );
  const tracks: Track[] = [];
  // One device after the other, like the private tracks: a long range is a heavy query.
  for (const device of picked) {
    tracks.push(
      from < to
        ? await buildTrack(ctx.db, device.deviceId, {
            from,
            to,
            maxAccuracy: maxAccuracyM,
            maxPoints: query.maxPoints,
          })
        : emptyTrack(device.deviceId),
    );
  }
  touchShareViews(ctx, [grant.id]);
  return { from: from.toISOString(), to: to.toISOString(), tracks };
}
