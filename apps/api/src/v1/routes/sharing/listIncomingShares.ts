import { incomingShareListResponseSchema } from "@trail/contracts/share";
import { loadIncomingShares } from "../../../sharing/incomingShares";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/shares/incoming` */
export const listIncomingShares = defineRoute(
  {
    method: "get",
    path: "/api/v1/shares/incoming",
    operationId: "listIncomingShares",
    summary: "List shares with you",
    description:
      "The current shares other people give you, newest first — also the ones of people you hid (`hiddenAt`), so you can show them again. Their positions are under People.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:read"] },
    responses: { 200: incomingShareListResponseSchema },
  },
  async ({ ctx, auth }) => ({
    status: 200,
    body: { shares: await loadIncomingShares(ctx.db, auth.user.id) },
  }),
);
