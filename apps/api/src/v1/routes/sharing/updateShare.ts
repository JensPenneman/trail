import {
  shareParamsSchema,
  shareResponseSchema,
  updateShareRequestSchema,
} from "@trail/contracts/share";
import { changeShare } from "../../../sharing/changeShare";
import { defineRoute } from "../../defineRoute";

/** `PATCH /api/v1/shares/{id}` */
export const updateShare = defineRoute(
  {
    method: "patch",
    path: "/api/v1/shares/{id}",
    operationId: "updateShare",
    summary: "Change a share",
    description:
      "Changes what a current share shows or how long it runs: a `duration` counts from now (extend or shorten), the other fields change only when given. History stays limited to precise shares (400 otherwise). The recipient sees the change at once.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:write"] },
    request: { params: shareParamsSchema, body: updateShareRequestSchema },
    responses: { 200: shareResponseSchema },
  },
  async ({ ctx, auth, params, body }) => ({
    status: 200,
    body: { share: await changeShare(ctx, auth, params.id, body) },
  }),
);
