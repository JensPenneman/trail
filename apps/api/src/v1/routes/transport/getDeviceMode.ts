import { deviceParamsSchema } from "@trail/contracts/devicePublic";
import { deviceModeResponseSchema } from "@trail/contracts/transport";
import { loadDeviceMode } from "../../../transport/deviceMode";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/devices/{id}/mode` */
export const getDeviceMode = defineRoute(
  {
    method: "get",
    path: "/api/v1/devices/{id}/mode",
    operationId: "getDeviceMode",
    summary: "Get a device's mode now",
    description:
      "How the device travels now: the mode set from a moment on that is still in force (`override`), and the current mode — that one, or the latest segment's while it is recent (a stop is `stationary`). `current` is null when the device has not reported for a while.",
    tags: ["Timeline"],
    auth: { scopes: ["locations:read"] },
    request: { params: deviceParamsSchema },
    responses: { 200: deviceModeResponseSchema },
  },
  async ({ ctx, auth, params }) => ({
    status: 200,
    body: {
      mode: await loadDeviceMode(ctx.db, auth, params.id, {
        now: new Date(),
        recentMs: ctx.config.liveWindowMinutes * 60_000,
      }),
    },
  }),
);
