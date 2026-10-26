import { personParamsSchema, personResponseSchema } from "@trail/contracts/person";
import { notFound } from "../../../http/httpError";
import { loadPeople } from "../../../sharing/loadPeople";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/people/{userId}` */
export const getPerson = defineRoute(
  {
    method: "get",
    path: "/api/v1/people/{userId}",
    operationId: "getPerson",
    summary: "Get a person",
    description:
      "One person who shares with you, as in the list. Someone who does not share with you (any more), or whom you hid, is 404.",
    tags: ["People"],
    auth: { scopes: ["people:read"] },
    request: { params: personParamsSchema },
    responses: { 200: personResponseSchema },
  },
  async ({ ctx, auth, params }) => {
    const [person] = await loadPeople(ctx, auth, params.userId);
    if (person === undefined) throw notFound("No such person.");
    return { status: 200, body: { person } };
  },
);
