import {
  deviceParamsSchema,
  deviceUpdateResponseSchema,
  deviceUpdateSchema,
} from "@trail/contracts/devicePublic";
import { changeDevice } from "../../../devices/changeDevice";
import { toDevicePublic } from "../../../devices/toDevicePublic";
import { defineRoute } from "../../defineRoute";

/** `PATCH /api/v1/devices/{id}` */
export const updateDevice = defineRoute(
  {
    method: "patch",
    path: "/api/v1/devices/{id}",
    operationId: "updateDevice",
    summary: "Change a device",
    description:
      "Renames the device, switches its silence alerts or queues a settings preset for Overland. Its credentials are out of reach: no token can replace a device's access token or delete a device, which takes a signed-in session. The answer has the device and its settings after the change; the device's position only for a credential with `locations:read`.",
    tags: ["Devices"],
    auth: { scopes: ["devices:write"] },
    request: { params: deviceParamsSchema, body: deviceUpdateSchema },
    responses: { 200: deviceUpdateResponseSchema },
  },
  async ({ ctx, auth, params, body }) => {
    const device = await changeDevice(ctx, auth, params.id, body);
    return {
      status: 200,
      body: {
        device: toDevicePublic(device, auth),
        settings: {
          alertsEnabled: device.alertsEnabled,
          pendingSettings: device.pendingSettings,
          settingsAppliedAt: device.settingsAppliedAt,
        },
      },
    };
  },
);
