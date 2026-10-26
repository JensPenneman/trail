import { deviceParamsSchema, devicePublicResponseSchema } from "@trail/contracts/devicePublic";
import { loadDeviceSummary } from "../../../devices/loadDeviceSummary";
import { toDevicePublic } from "../../../devices/toDevicePublic";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/devices/{id}` */
export const getDevice = defineRoute(
  {
    method: "get",
    path: "/api/v1/devices/{id}",
    operationId: "getDevice",
    summary: "Get a device",
    description: "One device, as in the list.",
    tags: ["Devices"],
    auth: { scopes: ["devices:read"] },
    request: { params: deviceParamsSchema },
    responses: { 200: devicePublicResponseSchema },
  },
  async ({ ctx, auth, params }) => ({
    status: 200,
    body: { device: toDevicePublic(await loadDeviceSummary(ctx.db, auth, params.id)) },
  }),
);
