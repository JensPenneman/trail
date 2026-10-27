import { createShareRequestSchema, shareResponseSchema } from "@trail/contracts/share";
import { startShare } from "../../../sharing/startShare";
import { defineRoute } from "../../defineRoute";

/** `POST /api/v1/shares` */
export const createShare = defineRoute(
  {
    method: "post",
    path: "/api/v1/shares",
    operationId: "createShare",
    summary: "Share your location",
    description:
      "Starts sharing your location with a person, one way: they see you under People, you do not see them unless they share back. Pick the devices (all by default, also later ones), the precision, history (precise only; live only by default), whether battery and activity come along (yes by default) and the duration. An address without an account gets a `pending` share: when someone signs up with it, it starts at once only if they came with an invitation to that very address; otherwise it is `joined` and waits until you confirm them. The answer shows whether the address has an account, and its name. One current share per address: change it instead (409). At most 50 at a time (409). A token limited to some devices shares only those, listed by id. Needs `locations:read` as well as `shares:write`: what you share can be precise positions.",
    tags: ["Sharing"],
    // A share or a link can show precise positions: it needs what reading them needs.
    auth: { scopes: ["shares:write", "locations:read"], all: true },
    request: { body: createShareRequestSchema },
    responses: { 201: shareResponseSchema },
    errors: [409],
  },
  async ({ ctx, auth, body }) => {
    const share = await startShare(ctx, auth, body);
    return { status: 201, body: { share }, resource: { shareId: share.id } };
  },
);
