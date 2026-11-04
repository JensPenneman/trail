import { personDaysResponseSchema, personParamsSchema } from "@trail/contracts/person";
import { weakEtag } from "../../../cache/weakEtag";
import { loadPersonDays } from "../../../sharing/loadPersonDays";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/people/{userId}/days` */
export const getPersonDays = defineRoute(
  {
    method: "get",
    path: "/api/v1/people/{userId}/days",
    operationId: "getPersonDays",
    summary: "Get the days a person recorded",
    description:
      "Which days a person recorded something, within the history they share with you: per shared device and local day, the points and the first and last time — no positions. The days are the person's own, in their account's time zone (`timezone`), because that is where their daily totals are cut; the window runs from the day their shared history begins in, counted from there on that first day, to today. A person without a share with history for you (or one you hid) is 404. They see in their data access log that you looked, with the window, not the days. The answer has an `ETag` that changes when their points or the share do.",
    tags: ["People"],
    auth: { scopes: ["people:read"] },
    request: { params: personParamsSchema },
    responses: { 200: personDaysResponseSchema, 304: null },
    access: { people: true },
  },
  async ({ ctx, auth, params }) => {
    const { days, shareId, deviceIds } = await loadPersonDays(ctx, auth, params.userId);
    return {
      status: 200,
      body: days,
      // Cheap to project from the daily statistics, so the body is its own validator.
      etag: weakEtag(auth.user.id, "getPersonDays", [params.userId, shareId, days]),
      owners: [
        {
          ownerUserId: params.userId,
          shareId,
          resource: { deviceIds, from: days.window.from, to: days.window.to },
        },
      ],
    };
  },
);
