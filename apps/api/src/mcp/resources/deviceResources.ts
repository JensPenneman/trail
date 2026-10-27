import {
  type ListResourcesResult,
  type McpServer,
  ProtocolError,
  ProtocolErrorCode,
  type ReadResourceResult,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import type { ApiScope } from "@trail/contracts/apiScope";
import { getCurrentLocationOutputSchema, listDevicesOutputSchema } from "@trail/contracts/mcp";
import type { z } from "zod";
import { hasScope } from "../../auth/requestAuth";
import { resolveDeviceIds } from "../../devices/resolveDeviceIds";
import { isUuid } from "../../lib/isUuid";
import type { ToolAnswer } from "../defineTool";
import type { McpSession } from "../mcpSession";
import { runMcpWork, type WorkContext } from "../runMcpWork";
import { currentLocationAnswer } from "../tools/getCurrentLocation";
import { devicesAnswer } from "../tools/listDevices";

const json = "application/json";
const devicesUri = "trail://devices";
const locationTemplate = "trail://devices/{id}/location";

interface JsonResource<Output extends z.ZodType> {
  /** The resource (or template) as the log names it. */
  name: string;
  /** Its action in the data access log. */
  action: string;
  uri: URL;
  scope: ApiScope;
  output: Output;
  work: (context: WorkContext) => Promise<ToolAnswer<z.input<Output>>>;
}

/**
 * Reads a resource like a tool call — scopes, read-only transaction, schema,
 * log, data access log — as JSON.
 */
async function readAsJson<Output extends z.ZodType>(
  session: McpSession,
  resource: JsonResource<Output>,
): Promise<ReadResourceResult> {
  const outcome = await runMcpWork(session, {
    kind: "resource",
    name: resource.name,
    executor: "read-only transaction",
    allowed: hasScope(session.principal, resource.scope),
    record: { action: resource.action, kind: "read" },
    work: resource.work,
    check: (answer) => {
      const parsed = resource.output.safeParse(answer.result);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, issues: parsed.error.issues };
    },
  });
  if (!outcome.ok) {
    if (outcome.notFound) throw new ResourceNotFoundError(resource.uri.href);
    throw new ProtocolError(ProtocolErrorCode.InternalError, outcome.message);
  }
  return {
    contents: [{ uri: resource.uri.href, mimeType: json, text: JSON.stringify(outcome.value) }],
  };
}

/** The location resources of the devices the token reaches (`resources/list`). */
async function listLocations(session: McpSession): Promise<ListResourcesResult> {
  const outcome = await runMcpWork(session, {
    kind: "resource",
    name: `${locationTemplate} (list)`,
    executor: "read-only transaction",
    allowed: hasScope(session.principal, "locations:read"),
    work: async (context) => {
      const devices = await resolveDeviceIds(context.db, context.principal, undefined);
      return { result: devices, items: devices.length };
    },
    check: (answer) => ({ ok: true, value: answer.result }),
  });
  if (!outcome.ok) throw new ProtocolError(ProtocolErrorCode.InternalError, outcome.message);
  return {
    resources: outcome.value.map((device) => ({
      uri: `trail://devices/${device.id}/location`,
      name: `device-location-${device.id}`,
      // The id, not the name: a listing's titles reach the model outside any data field.
      title: `Location of device ${device.id}`,
      mimeType: json,
    })),
  };
}

/**
 * The two resources (docs/mcp.md): `trail://devices`, the devices as
 * `list_devices` answers them (`devices:read`), and
 * `trail://devices/{id}/location`, one device's position as
 * `get_current_location` answers it (`locations:read`). Each is registered
 * only for a token with its scope; the location resources list the devices
 * the token reaches, and any other id reads as not found.
 */
export function registerDeviceResources(server: McpServer, session: McpSession): void {
  if (hasScope(session.principal, "devices:read")) {
    server.registerResource(
      "devices",
      devicesUri,
      {
        title: "Devices",
        description:
          "The devices this token reaches: status, last upload and battery, without positions, and the mode with locations:read (as list_devices).",
        mimeType: json,
      },
      (uri) =>
        readAsJson(session, {
          name: devicesUri,
          action: "mcp.resource.devices",
          uri,
          scope: "devices:read",
          output: listDevicesOutputSchema,
          work: devicesAnswer,
        }),
    );
  }
  if (hasScope(session.principal, "locations:read")) {
    server.registerResource(
      "device-location",
      new ResourceTemplate(locationTemplate, { list: () => listLocations(session) }),
      {
        title: "Device location",
        description:
          "Where one device is now: its newest known position (WGS84), age, speed, battery and mode (as get_current_location).",
        mimeType: json,
      },
      (uri, variables) => {
        const id = variables["id"];
        if (typeof id !== "string" || !isUuid(id)) throw new ResourceNotFoundError(uri.href);
        return readAsJson(session, {
          name: locationTemplate,
          action: "mcp.resource.device_location",
          uri,
          scope: "locations:read",
          output: getCurrentLocationOutputSchema,
          work: (context) => currentLocationAnswer(context, id),
        });
      },
    );
  }
}
