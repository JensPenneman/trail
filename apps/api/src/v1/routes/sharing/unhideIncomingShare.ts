import { incomingShareResponseSchema, shareParamsSchema } from "@trail/contracts/share";
import { setPersonHidden } from "../../../sharing/setPersonHidden";
import { defineRoute } from "../../defineRoute";

/** `POST /api/v1/shares/incoming/{id}/unhide` */
export const unhideIncomingShare = defineRoute(
  {
    method: "post",
    path: "/api/v1/shares/incoming/{id}/unhide",
    operationId: "unhideIncomingShare",
    summary: "Show a hidden person",
    description: "Shows a person you hid under People again.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:write"] },
    request: { params: shareParamsSchema },
    responses: { 200: incomingShareResponseSchema },
  },
  async ({ ctx, auth, params }) => ({
    status: 200,
    body: { share: await setPersonHidden(ctx, auth, params.id, false) },
  }),
);
