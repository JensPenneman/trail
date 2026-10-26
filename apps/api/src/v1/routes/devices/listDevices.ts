import { devicePublicListResponseSchema } from "@trail/contracts/devicePublic";
import { loadDeviceSummaries } from "../../../devices/loadDeviceSummaries";
import { toDevicePublic } from "../../../devices/toDevicePublic";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/devices` */
export const listDevices = defineRoute(
  {
    method: "get",
    path: "/api/v1/devices",
    operationId: "listDevices",
    summary: "List devices",
    description:
      "Every device of the account — or, for a token limited to some devices, those — with its status, battery, trip in progress and point counts, and with its latest position for a credential that holds `locations:read`.",
    tags: ["Devices"],
    auth: { scopes: ["devices:read"] },
    responses: { 200: devicePublicListResponseSchema },
  },
  async ({ ctx, auth }) => ({
    status: 200,
    body: {
      devices: (await loadDeviceSummaries(ctx.db, auth)).map((summary) =>
        toDevicePublic(summary, auth),
      ),
    },
  }),
);
