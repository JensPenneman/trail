import { dataAccessLogQuerySchema, dataAccessLogResponseSchema } from "@trail/contracts/dataAccess";
import { loadAccessLog } from "../../../dataAccess/loadAccessLog";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/access-log` */
export const listAccessLog = defineRoute(
  {
    method: "get",
    path: "/api/v1/access-log",
    operationId: "listAccessLog",
    summary: "List the data access log",
    description:
      "Who read or changed your data, a line per hour and kind of access, newest first: you in your browser, your API tokens (directly or through the MCP server), the people you share with — when they looked at you, through which share, and what — and the visitors of your public links, as their network and kind of browser. Each line says what was read or changed (devices, a range, a level, a share …), never where. Filter by period, kinds of actor, channels and action; follow `nextCursor` for older lines. The log is yours alone: nobody else, an administrator neither, can read it. Reading it is not recorded.",
    tags: ["Access log"],
    // The log is the whole account's: a token limited to some devices may not read it.
    auth: { scopes: ["audit:read"], allDevices: true },
    request: { query: dataAccessLogQuerySchema },
    responses: { 200: dataAccessLogResponseSchema },
    // The log does not log itself.
    access: false,
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await loadAccessLog(ctx.db, auth.user.id, query),
  }),
);
