import { tokenVerificationSchema } from "@trail/contracts/apiToken";
import { describeToken } from "../../../apiTokens/describeToken";
import { HttpError } from "../../../http/httpError";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/tokens/verify` */
export const verifyToken = defineRoute(
  {
    method: "get",
    path: "/api/v1/tokens/verify",
    operationId: "verifyToken",
    summary: "Verify the token",
    description:
      "Checks the API token the request carries and describes it: its name, scopes, devices and expiry. A token that is refused gets the usual 401 instead, so this is the call to test a token with, or to find out when it expires. Only a token can be verified: a signed-in session gets 400.",
    tags: ["Tokens"],
    auth: "token",
    responses: { 200: tokenVerificationSchema },
  },
  async ({ ctx, auth }) => {
    const token = await describeToken(ctx.db, auth);
    // Only when the token was deleted between its check and this lookup.
    if (token === null) throw new HttpError(401, "unauthorized", "This API token is not valid.");
    return { status: 200, body: token };
  },
);
