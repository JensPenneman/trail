import { shareLinkParamsSchema } from "@trail/contracts/shareLink";
import { turnOffShareLink } from "../../../sharing/turnOffShareLink";
import { defineRoute } from "../../defineRoute";

/** `DELETE /api/v1/share-links/{id}` */
export const deleteShareLink = defineRoute(
  {
    method: "delete",
    path: "/api/v1/share-links/{id}",
    operationId: "deleteShareLink",
    summary: "Turn a public link off",
    description: "Turns a link off at once: its page says that it has ended.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:write"] },
    request: { params: shareLinkParamsSchema },
    responses: { 204: null },
  },
  async ({ ctx, auth, params }) => {
    await turnOffShareLink(ctx, auth, params.id);
    return { status: 204 };
  },
);
