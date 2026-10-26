import { peopleResponseSchema } from "@trail/contracts/person";
import { loadPeople } from "../../../sharing/loadPeople";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/people` */
export const listPeople = defineRoute(
  {
    method: "get",
    path: "/api/v1/people",
    operationId: "listPeople",
    summary: "List people",
    description:
      "The people who share their location with you, by name, each with the devices they share and where those are, at the precision of the share: approximate and area shares give the centre of a cell around the position, never the position itself. A device's `location` is the newest position inside the share's window (its history, or the last 12 hours for live-only shares); battery and activity appear only when the share includes details. People you hid are left out. `distanceM` starts from your own most recently located device and needs `locations:read` too.",
    tags: ["People"],
    auth: { scopes: ["people:read"] },
    responses: { 200: peopleResponseSchema },
  },
  async ({ ctx, auth }) => ({ status: 200, body: { people: await loadPeople(ctx, auth) } }),
);
