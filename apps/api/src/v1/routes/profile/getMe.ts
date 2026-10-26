import { profileResponseSchema } from "@trail/contracts/profile";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/me` */
export const getMe = defineRoute(
  {
    method: "get",
    path: "/api/v1/me",
    operationId: "getMe",
    summary: "Get the account",
    description:
      "The account the token or session belongs to. Its time zone decides where the account's local days begin and end.",
    tags: ["Profile"],
    auth: { scopes: ["profile:read"] },
    responses: { 200: profileResponseSchema },
  },
  ({ auth }) => ({
    status: 200,
    body: {
      user: { id: auth.user.id, displayName: auth.user.displayName, timezone: auth.user.timezone },
    },
  }),
);
