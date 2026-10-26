import { shareListResponseSchema } from "@trail/contracts/share";
import { loadOutgoingShares } from "../../../sharing/outgoingShares";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/shares` */
export const listShares = defineRoute(
  {
    method: "get",
    path: "/api/v1/shares",
    operationId: "listShares",
    summary: "List your shares",
    description:
      "The people you share your location with: current shares (not stopped, not ended), newest first, with what each shows and until when, whether the address has an account yet (`pending`), whether someone signed up with it and waits for your confirmation (`joined`), whether the person hid you (`hidden`), and when they last looked.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:read"] },
    responses: { 200: shareListResponseSchema },
  },
  async ({ ctx, auth }) => ({
    status: 200,
    body: { shares: await loadOutgoingShares(ctx.db, auth.user.id) },
  }),
);
