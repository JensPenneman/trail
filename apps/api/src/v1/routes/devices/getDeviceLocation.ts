import { deviceLocationResponseSchema, deviceParamsSchema } from "@trail/contracts/devicePublic";
import { findOwnedDevice } from "../../../devices/findOwnedDevice";
import { toDeviceLocation } from "../../../devices/toDeviceLocation";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/devices/{id}/location` */
export const getDeviceLocation = defineRoute(
  {
    method: "get",
    path: "/api/v1/devices/{id}/location",
    operationId: "getDeviceLocation",
    summary: "Get a device's location",
    description:
      "Where the device is now: the newest position it reported (a stored point or the phone's current position) with accuracy, speed and course, and its last battery reading. `location` is null until the device sends its first position.",
    tags: ["Devices"],
    auth: { scopes: ["locations:read"] },
    request: { params: deviceParamsSchema },
    responses: { 200: deviceLocationResponseSchema },
  },
  async ({ ctx, auth, params }) => ({
    status: 200,
    body: { location: toDeviceLocation(await findOwnedDevice(ctx.db, auth, params.id)) },
  }),
);
