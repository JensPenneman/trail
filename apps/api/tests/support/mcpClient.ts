import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { apiPaths } from "@trail/contracts/apiPaths";

/** The protocol era a test client speaks: 2025 (`initialize`) or 2026-07-28 (per-request envelope). */
export type McpEra = "legacy" | "modern";

/** The MCP endpoint of a test app. */
export function mcpUrl(app: Server): URL {
  const { port } = app.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}${apiPaths.mcp}`);
}

/** Every response the client received: status and content type, in order. */
export interface Exchange {
  status: number;
  contentType: string | null;
}

/**
 * The SDK's own client, connected to the test app over Streamable HTTP with an
 * API token, as an MCP client such as Claude Code connects. `exchanges`
 * records what came back, so tests can check the answers were JSON.
 */
export async function connectMcp(
  app: Server,
  secret: string,
  options: { era?: McpEra; headers?: Record<string, string> } = {},
): Promise<{ client: Client; exchanges: Exchange[] }> {
  const exchanges: Exchange[] = [];
  const client = new Client(
    { name: "trail-tests", version: "1.0.0" },
    options.era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  const transport = new StreamableHTTPClientTransport(mcpUrl(app), {
    requestInit: { headers: { Authorization: `Bearer ${secret}`, ...options.headers } },
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      exchanges.push({
        status: response.status,
        contentType: response.headers.get("content-type"),
      });
      return response;
    },
  });
  await client.connect(transport);
  return { client, exchanges };
}

/** Every key anywhere in a JSON value: what a test checks to prove there are no coordinates. */
export function keysOf(value: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, inner] of Object.entries(node)) {
        keys.add(key);
        walk(inner);
      }
    }
  };
  walk(value);
  return keys;
}

/** Keys that would carry a position. */
export const coordinateKeys = [
  "lat",
  "lon",
  "latitude",
  "longitude",
  "place",
  "centroid",
  "coordinates",
];
