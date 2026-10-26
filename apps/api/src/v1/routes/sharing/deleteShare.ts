import { shareParamsSchema } from "@trail/contracts/share";
import { stopShare } from "../../../sharing/stopShare";
import { defineRoute } from "../../defineRoute";

/** `DELETE /api/v1/shares/{id}` */
export const deleteShare = defineRoute(
  {
    method: "delete",
    path: "/api/v1/shares/{id}",
    operationId: "deleteShare",
    summary: "Stop sharing",
    description:
      "Stops a share at once: from this moment the person sees nothing of you, in any read or live event. A pending share is withdrawn before anyone could see it.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:write"] },
    request: { params: shareParamsSchema },
    responses: { 204: null },
  },
  async ({ ctx, auth, params }) => {
    await stopShare(ctx, auth, params.id);
    return { status: 204 };
  },
);
