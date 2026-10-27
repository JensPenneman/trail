import { dataAccessSummaryQuerySchema, dataAccessSummarySchema } from "@trail/contracts/dataAccess";
import { parseDataAccessActorId } from "@trail/contracts/dataAccessActorId";
import { loadAccessSummary } from "../../../dataAccess/loadAccessSummary";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/access-log/summary` */
export const getAccessLogSummary = defineRoute(
  {
    method: "get",
    path: "/api/v1/access-log/summary",
    operationId: "getAccessLogSummary",
    summary: "Summarise the data access log",
    description:
      "Who looked at your data over the last 7, 30 or 90 days, today included: totals per kind of actor, channel and kind of access, a series per day of your time zone, the people who looked (with what), your public links (with their distinct visitors) and your API tokens, each with how often and when last — and your own activity in the browser apart from everyone else's. With `actorId`, all of it for one actor: what one person looked at, what one token did, how often one link was opened.",
    tags: ["Access log"],
    // The log is the whole account's: a token limited to some devices may not read it.
    auth: { scopes: ["audit:read"], allDevices: true },
    request: { query: dataAccessSummaryQuerySchema },
    responses: { 200: dataAccessSummarySchema },
    access: false,
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await loadAccessSummary(ctx.db, auth.user, {
      days: query.days,
      only:
        query.actorId === undefined
          ? undefined
          : (parseDataAccessActorId(query.actorId) ?? undefined),
    }),
  }),
);
