import { deviceParamsSchema } from "@trail/contracts/devicePublic";
import { deviceModeResponseSchema, setDeviceModeRequestSchema } from "@trail/contracts/transport";
import { setDeviceMode as applyDeviceMode, loadDeviceMode } from "../../../transport/deviceMode";
import { defineRoute } from "../../defineRoute";
import { principalSource } from "./principalSource";

/** `POST /api/v1/devices/{id}/mode` */
export const setDeviceMode = defineRoute(
  {
    method: "post",
    path: "/api/v1/devices/{id}/mode",
    operationId: "setDeviceMode",
    summary: "Set the mode from now on",
    description:
      "The quick toggle: from now on the device travels by `mode`, until `until` or the next detected stop, whichever comes first. It is idempotent — the same mode again changes nothing — another mode ends the running one and starts anew, and `mode: null` ends it, so inference takes over again.",
    tags: ["Timeline"],
    // The answer carries the segment or the current mode: location data.
    auth: { scopes: ["locations:read", "locations:write"], all: true },
    request: { params: deviceParamsSchema, body: setDeviceModeRequestSchema },
    responses: { 200: deviceModeResponseSchema },
  },
  async ({ ctx, auth, params, body }) => {
    const now = new Date();
    const { changed } = await applyDeviceMode(
      ctx.db,
      auth,
      params.id,
      { mode: body.mode, until: body.until === undefined ? undefined : new Date(body.until) },
      { source: principalSource(auth), now, queue: ctx.processing.enabled },
    );
    if (changed !== null) {
      ctx.processing.notify();
      ctx.bus.publish(auth.user.id, {
        type: "segments",
        deviceId: params.id,
        from: changed.from.toISOString(),
        to: changed.to.toISOString(),
      });
    }
    return {
      status: 200,
      body: {
        mode: await loadDeviceMode(ctx.db, auth, params.id, {
          now,
          recentMs: ctx.config.liveWindowMinutes * 60_000,
        }),
      },
    };
  },
);
