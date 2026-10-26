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
      "Changes what a current share shows or how long it runs: a `duration` counts from now (extend or shorten), the other fields change only when given. History stays limited to precise shares (400 otherwise). The recipient sees the change at once. A token limited to some devices changes only shares that show nothing but its devices, before and after the change (403). Needs `locations:read` as well as `shares:write`.",
    tags: ["Sharing"],
    // A share or a link can show precise positions: it needs what reading them needs.
    auth: { scopes: ["shares:write", "locations:read"], all: true },
    request: { params: shareParamsSchema, body: updateShareRequestSchema },
    responses: { 200: shareResponseSchema },
  },
  async ({ ctx, auth, params, body }) => ({
    status: 200,
    body: { share: await changeShare(ctx, auth, params.id, body) },
  }),
);
