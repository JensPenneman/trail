import {
  createShareLinkRequestSchema,
  createShareLinkResponseSchema,
} from "@trail/contracts/shareLink";
import { makeShareLink } from "../../../sharing/makeShareLink";
import { defineRoute } from "../../defineRoute";

/** `POST /api/v1/share-links` */
export const createShareLink = defineRoute(
  {
    method: "post",
    path: "/api/v1/share-links",
    operationId: "createShareLink",
    summary: "Make a public link",
    description:
      "Makes a secret web address that shows your location to anyone who has it, without an account: a page with the label, the devices you pick at the precision you pick, optionally their track of the last days (precise only) and battery and activity. It always expires — in 24 hours unless you choose another time, within 30 days — and you can turn it off at any time. The answer carries the secret and the address once; Trail keeps only a hash. At most 20 links work at a time (409).",
    tags: ["Sharing"],
    auth: { scopes: ["shares:write"] },
    request: { body: createShareLinkRequestSchema },
    responses: { 201: createShareLinkResponseSchema },
    errors: [409],
  },
  async ({ ctx, auth, body }) => ({ status: 201, body: await makeShareLink(ctx, auth, body) }),
);
