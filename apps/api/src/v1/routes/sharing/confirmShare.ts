import { shareParamsSchema, shareResponseSchema } from "@trail/contracts/share";
import { confirmShare as confirm } from "../../../sharing/confirmShare";
import { defineRoute } from "../../defineRoute";

/** `POST /api/v1/shares/{id}/confirm` */
export const confirmShare = defineRoute(
  {
    method: "post",
    path: "/api/v1/shares/{id}/confirm",
    operationId: "confirmShare",
    summary: "Confirm who joined",
    description:
      "Someone signed up with the address of a share that waited for it (`joined`): confirm that they are the person you meant, and the share starts. Trail does not verify addresses, so it does not start on its own — unless they signed up with an invitation to that very address. 409 when nobody has signed up with the address yet, or when the share already reaches its person. A token limited to some devices confirms only shares that show nothing but its devices (403).",
    tags: ["Sharing"],
    auth: { scopes: ["shares:write", "locations:read"], all: true },
    request: { params: shareParamsSchema },
    responses: { 200: shareResponseSchema },
    errors: [409],
  },
  async ({ ctx, auth, params }) => ({
    status: 200,
    body: { share: await confirm(ctx, auth, params.id) },
  }),
);
