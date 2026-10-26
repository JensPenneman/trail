import { shareLinkListResponseSchema } from "@trail/contracts/shareLink";
import { loadShareLinks } from "../../../sharing/loadShareLinks";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/share-links` */
export const listShareLinks = defineRoute(
  {
    method: "get",
    path: "/api/v1/share-links",
    operationId: "listShareLinks",
    summary: "List public links",
    description:
      "Your public links that were not turned off, newest first, with what each shows, when it expires and how often it was opened. Expired links stay listed for 30 days. Secrets are never listed: a link's address is shown once, when it is made.",
    tags: ["Sharing"],
    auth: { scopes: ["shares:read"] },
    responses: { 200: shareLinkListResponseSchema },
  },
  async ({ ctx, auth }) => ({
    status: 200,
    body: { links: await loadShareLinks(ctx.db, auth.user.id) },
  }),
);
