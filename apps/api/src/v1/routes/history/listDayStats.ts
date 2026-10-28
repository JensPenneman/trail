import { dayStatsQuerySchema, dayStatsResponseSchema } from "@trail/contracts/statsPublic";
import { weakEtag } from "../../../cache/weakEtag";
import { findDayStats } from "../../../stats/findDayStats";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/stats/days` */
export const listDayStats = defineRoute(
  {
    method: "get",
    path: "/api/v1/stats/days",
    operationId: "listDayStats",
    summary: "List daily statistics",
    description:
      "Points, distance and the first and last point of every device on every local day from `from` to `to` (both included) that has points, each with its `stamp`. Days follow the account's time zone, which the answer repeats. At most 400 days at once. Send the `ETag` back as `If-None-Match` and the answer is `304` while it stays the same.",
    tags: ["History"],
    auth: { scopes: ["history:read"] },
    request: { query: dayStatsQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: dayStatsResponseSchema, 304: null },
  },
  async ({ ctx, auth, query }) => {
    const body = {
      timezone: auth.user.timezone,
      days: await findDayStats(ctx.db, auth, {
        from: query.from,
        to: query.to,
        deviceIds: query.devices,
      }),
    };
    // A few hundred small rows: their hash is the validator (docs/architecture.md §8.9).
    return { status: 200, body, etag: weakEtag(auth.user.id, "listDayStats", body) };
  },
);
