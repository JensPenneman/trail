import { incomingShareResponseSchema, shareParamsSchema } from "@trail/contracts/share";
import { setPersonHidden } from "../../../sharing/setPersonHidden";
import { defineRoute } from "../../defineRoute";

/** `POST /api/v1/shares/incoming/{id}/hide` */
export const hideIncomingShare = defineRoute(
  {
    method: "post",
    path: "/api/v1/shares/incoming/{id}/hide",
    operationId: "hideIncomingShare",
    summary: "Hide a person",
    description:
      "Hides the person who gives you this share: they disappear from People and their live updates stop reaching you, until you show them again. They keep sharing and are told that you hid them.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:write"] },
    request: { params: shareParamsSchema },
    responses: { 200: incomingShareResponseSchema },
  },
  async ({ ctx, auth, params }) => ({
    status: 200,
    body: { share: await setPersonHidden(ctx, auth, params.id, true) },
  }),
);
