import { pointPageSchema, pointsQuerySchema } from "@trail/contracts/locationPublic";
import { findOwnedDevice } from "../../../devices/findOwnedDevice";
import { decodePointCursor, encodePointCursor } from "../../../locations/pointCursor";
import { readPoints } from "../../../locations/readPoints";
import { toPoint } from "../../../locations/toPoint";
import { defineRoute } from "../../defineRoute";

const optionalDate = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

/** `GET /api/v1/locations` */
export const listLocations = defineRoute(
  {
    method: "get",
    path: "/api/v1/locations",
    operationId: "listLocations",
    summary: "List points",
    description:
      "The points one device recorded, exactly as the phone sent them (no smoothing, no map matching), oldest first and a page at a time: follow `nextCursor` until it is null. `from` and `to` narrow the range. A phone uploads when it can, so points may arrive later than newer ones: to keep a copy current, ask again for a range that overlaps the end of the last one.",
    tags: ["Locations"],
    auth: { scopes: ["locations:read"] },
    request: { query: pointsQuerySchema },
    // `device` names one: unknown, foreign or outside the token, it is a 404.
    errors: [404],
    responses: { 200: pointPageSchema },
  },
  async ({ ctx, auth, query }) => {
    const device = await findOwnedDevice(ctx.db, auth, query.device);
    const { rows, more } = await readPoints(ctx.db, device.id, {
      order: "asc",
      from: optionalDate(query.from),
      to: optionalDate(query.to),
      after:
        query.cursor === undefined || query.cursor === ""
          ? undefined
          : decodePointCursor(query.cursor),
      limit: query.limit,
    });
    const last = rows.at(-1);
    return {
      status: 200,
      body: {
        items: rows.map(toPoint),
        nextCursor: more && last !== undefined ? encodePointCursor(last.recordedAt) : null,
      },
    };
  },
);
