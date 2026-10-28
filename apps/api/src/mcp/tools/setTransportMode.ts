import { setTransportModeInputSchema, setTransportModeOutputSchema } from "@trail/contracts/mcp";
import { loadDeviceMode, setDeviceMode } from "../../transport/deviceMode";
import { chooseDevice } from "../chooseDevice";
import { presentCurrentMode } from "../currentModeOf";
import { defineTool } from "../defineTool";
import { deviceRef, quoted } from "../deviceRef";
import { ownAccess } from "../toolAccess";
import { formatInZone } from "../zonedTime";

/**
 * `set_transport_mode` — the quick toggle (docs/architecture.md §17.5), set
 * by an agent (source `mcp`). Its answer holds the device's mode now, which
 * is location data: the tool needs `locations:read` as well as
 * `locations:write`, like `POST /api/v1/devices/{id}/mode`.
 */
export const setTransportMode = defineTool({
  name: "set_transport_mode",
  title: "Set the transport mode",
  description:
    "Tells Trail how a device travels from now on — for example that the owner just boarded a train — until `until`, the first stop of 10 minutes or more Trail detects, or — after a stop — a move it reads as another kind of travel (on foot, by bike, by vehicle), whichever comes first: changing trains does not end it, cycling home from the station does, and the ride it was set for is its own all the way. The same mode again changes nothing; another mode replaces it; `mode: null` ends it and Trail works the mode out again. Only for what the owner said or clearly confirmed. Without `device`, the device that reported a position most recently.",
  scopes: ["locations:read", "locations:write"],
  input: setTransportModeInputSchema,
  output: setTransportModeOutputSchema,
  access: "write",
  async run(input, context) {
    const { ctx, principal, now, timeZone } = context;
    const summary = await chooseDevice(ctx.db, principal, input.device);
    const { changed } = await setDeviceMode(
      ctx.db,
      principal,
      summary.id,
      { mode: input.mode, until: input.until === undefined ? undefined : new Date(input.until) },
      { source: "mcp", now, queue: ctx.processing.enabled },
    );
    if (changed !== null) {
      ctx.processing.notify();
      ctx.bus.publish(principal.user.id, {
        type: "segments",
        deviceId: summary.id,
        from: changed.from.toISOString(),
        to: changed.to.toISOString(),
      });
    }
    const mode = await loadDeviceMode(ctx.db, principal, summary.id, {
      now,
      recentMs: ctx.config.liveWindowMinutes * 60_000,
    });
    const device = deviceRef(summary);
    const override =
      mode.override === null
        ? null
        : {
            mode: mode.override.mode,
            from: formatInZone(new Date(mode.override.from), timeZone),
            until:
              mode.override.until === null
                ? null
                : formatInZone(new Date(mode.override.until), timeZone),
          };
    const until =
      override?.until === null || override === null
        ? "until a stop of 10 minutes or more, or another kind of travel after a stop"
        : `until ${override.until}, a stop of 10 minutes or more, or another kind of travel after a stop, whichever comes first`;
    return {
      result: { device, override, currentMode: presentCurrentMode(mode, timeZone) },
      text:
        override === null
          ? `${quoted(device.name)}: no mode set any more; Trail works it out again.`
          : `${quoted(device.name)} travels by ${override.mode} from ${override.from}, ${until}.`,
      access: ownAccess([summary], { mode: input.mode }),
    };
  },
});
